import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";

const app = express();

// Middleware CORS para Vercel
const allowedOrigins = [
  'http://localhost:5173',
  'https://front-pos-khaki.vercel.app',
  'https://tu-frontend.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// Manejar preflight requests
app.options('*', cors());

// 🔍 Logging de requests
app.use((req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ===================== CONEXIÓN SUPABASE =====================
let supabase = null;

const initializeSupabase = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('https://')) {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(supabaseUrl, supabaseKey);
      console.log("✅ Conectado a Supabase (PostgreSQL)");
      return true;
    } else {
      console.log("⚠️  Supabase no configurado - Modo simulación activado");
      return false;
    }
  } catch (error) {
    console.error("❌ Error conectando a Supabase:", error.message);
    return false;
  }
};

// Inicializar Supabase al inicio
initializeSupabase();

// Función helper para ejecutar queries (compatible con tu código original)
const db = {
  query: async (text, params) => {
    if (!supabase) {
      throw new Error("Supabase no configurado");
    }
    
    // Convertir queries de PostgreSQL a Supabase
    if (text.trim().toUpperCase().startsWith('SELECT')) {
      const { data, error } = await supabase.from(detectTableName(text)).select('*');
      if (error) throw error;
      return { rows: data || [] };
    }
    
    if (text.trim().toUpperCase().startsWith('INSERT')) {
      const tableName = detectTableName(text);
      const { data, error } = await supabase.from(tableName).insert(extractInsertData(text, params)).select();
      if (error) throw error;
      return { rows: data || [] };
    }
    
    // Para otras operaciones, usar Supabase directamente
    throw new Error(`Query no soportada en modo Supabase: ${text}`);
  },
};

// Helper functions para compatibilidad
function detectTableName(query) {
  const match = query.match(/FROM\s+(\w+)/i) || query.match(/INSERT\s+INTO\s+(\w+)/i);
  return match ? match[1] : 'unknown';
}

function extractInsertData(query, params) {
  // Implementación básica - puedes expandir según necesites
  const valuesMatch = query.match(/VALUES\s*\(([^)]+)\)/i);
  if (valuesMatch && params) {
    const columns = query.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
    if (columns) {
      const columnNames = columns[1].split(',').map(col => col.trim());
      const data = {};
      columnNames.forEach((col, index) => {
        data[col] = params[index];
      });
      return data;
    }
  }
  return params || {};
}

// ===================== MIDDLEWARE JWT (MANTENIDO) =====================
function verificarToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ message: "Token no proporcionado" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ message: "Formato de token inválido. Use: Bearer <token>" });
  }

  const token = parts[1];

  if (!token) {
    return res.status(401).json({ message: "Token no proporcionado" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "clave_secreta", (err, user) => {
    if (err) {
      console.log("❌ ERROR al verificar token:", err.message);
      return res.status(403).json({ message: "Token inválido o expirado" });
    }
    console.log("✅ Token verificado. Usuario:", user);
    req.user = user;
    next();
  });
}

// ===================== ENRUTADOR PRINCIPAL DE LA API =====================
const apiRouter = express.Router();

// Rutas estáticas
apiRouter.get("/health", (req, res) => {
  res.json({
    message: "Servidor funcionando correctamente",
    timestamp: new Date().toISOString(),
    database: supabase ? "Supabase Conectado" : "Modo Simulación",
  });
});

// ===================== RUTAS DE PERMISOS =====================
apiRouter.get("/permissions/:employeeId", verificarToken, async (req, res) => {
  console.log("🔹 Usuario intentando obtener permisos:", req.user);

  if (req.user.rol !== "admin") {
    return res.status(403).json({ message: "Solo los administradores pueden ver permisos" });
  }

  const { employeeId } = req.params;

  try {
    if (!supabase) {
      // Modo simulación
      const defaultPermissions = {
        can_view_products: true,
        can_edit_products: false,
        can_delete_products: false,
        can_create_products: false,
        can_view_sales: true,
        can_create_sales: true,
        can_view_customers: true,
        can_edit_customers: false,
        can_view_reports: false,
        can_manage_stock: false
      };
      return res.json({ permissions: defaultPermissions });
    }

    // Modo Supabase
    const { data: permissions, error } = await supabase
      .from('user_permissions')
      .select('permissions')
      .eq('user_id', employeeId)
      .single();

    if (error || !permissions) {
      const defaultPermissions = {
        can_view_products: true,
        can_edit_products: false,
        can_delete_products: false,
        can_create_products: false,
        can_view_sales: true,
        can_create_sales: true,
        can_view_customers: true,
        can_edit_customers: false,
        can_view_reports: false,
        can_manage_stock: false
      };
      return res.json({ permissions: defaultPermissions });
    }

    res.json({ permissions: permissions.permissions });
  } catch (error) {
    console.error("Error al obtener permisos:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

apiRouter.post("/permissions", verificarToken, async (req, res) => {
  console.log("🔹 Usuario intentando guardar permisos:", req.user);

  if (req.user.rol !== "admin") {
    return res.status(403).json({ message: "Solo los administradores pueden modificar permisos" });
  }

  const { employee_id, permissions } = req.body;

  if (!employee_id || !permissions) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    if (!supabase) {
      return res.json({ message: "Permisos guardados correctamente (simulación)" });
    }

    const { error } = await supabase
      .from('user_permissions')
      .upsert({ 
        user_id: employee_id, 
        permissions: permissions 
      }, {
        onConflict: 'user_id'
      });

    if (error) throw error;

    res.json({ message: "Permisos guardados correctamente" });
  } catch (error) {
    console.error("Error al guardar permisos:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===================== RUTAS DE CLIENTES =====================
apiRouter.get("/clientes", verificarToken, async (req, res) => {
  try {
    if (!supabase) {
      // Modo simulación
      return res.json([
        { id: 1, nombre: "Cliente Demo 1", telefono: "123456789", saldo_pendiente: 0 },
        { id: 2, nombre: "Cliente Demo 2", telefono: "987654321", saldo_pendiente: 150.75 }
      ]);
    }

    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre');

    if (error) throw error;

    res.json(clientes || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
});

apiRouter.get("/clientes/con-deuda", verificarToken, async (req, res) => {
  console.log("🔍 SOLICITUD RECIBIDA: Obtener clientes con deuda");
  try {
    if (!supabase) {
      return res.json([
        { id: 2, nombre: "Cliente Demo 2", telefono: "987654321", saldo_pendiente: 150.75 }
      ]);
    }

    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('id, nombre, rut, telefono, saldo_pendiente')
      .gt('saldo_pendiente', 0)
      .order('nombre');

    if (error) throw error;

    console.log(`✅ ${clientes?.length || 0} clientes con deuda encontrados.`);
    res.json(clientes || []);
  } catch (error) {
    console.error("❌ ERROR al obtener clientes con deuda:", error);
    res.status(500).json({
      error: "No se puede mostrar clientes con deuda",
      message: error.message
    });
  }
});

apiRouter.post("/clientes", verificarToken, async (req, res) => {
  const { rut, nombre, telefono, email, direccion } = req.body;

  if (!nombre || !telefono) {
    return res.status(400).json({ message: "Nombre y teléfono son obligatorios" });
  }

  try {
    if (!supabase) {
      const nuevoCliente = {
        id: Math.random(),
        nombre,
        telefono,
        email,
        direccion,
        saldo_pendiente: 0,
        created_at: new Date().toISOString()
      };
      return res.status(201).json({
        ...nuevoCliente,
        message: "Cliente creado exitosamente (simulación)"
      });
    }

    const { data: cliente, error } = await supabase
      .from('clientes')
      .insert([{ 
        rut: rut?.trim(), 
        nombre, 
        telefono, 
        email, 
        direccion,
        saldo_pendiente: 0 
      }])
      .select();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: "El RUT ya está registrado" });
      }
      throw error;
    }

    res.status(201).json({
      ...cliente[0],
      message: "Cliente creado exitosamente"
    });
  } catch (error) {
    res.status(500).json({ error: "Error al crear cliente" });
  }
});

// ===================== RUTAS DE USUARIOS =====================
apiRouter.get("/usuarios", verificarToken, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ message: "Solo los administradores pueden ver usuarios" });
  }

  try {
    if (!supabase) {
      return res.json([
        { id: 1, username: 'admin', nombre: 'Administrador', rol: 'admin' },
        { id: 2, username: 'vendedor1', nombre: 'Vendedor Demo', rol: 'vendedor' }
      ]);
    }

    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, username, nombre, rol')
      .order('nombre');

    if (error) throw error;

    res.json(usuarios || []);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

apiRouter.post("/usuarios", verificarToken, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ message: "Solo los administradores pueden crear usuarios" });
  }

  const { username, nombre, password, rol } = req.body;
  if (!username || !nombre || !password || !rol) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  try {
    if (!supabase) {
      const nuevoUsuario = {
        id: Math.random(),
        username,
        nombre,
        rol,
        created_at: new Date().toISOString()
      };
      return res.json(nuevoUsuario);
    }

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .insert([{ username, nombre, password, rol }])
      .select('id, username, nombre, rol');

    if (error) throw error;

    res.json(usuario[0]);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===================== RUTA DE LOGIN =====================
apiRouter.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  try {
    // Modo simulación
    if (!supabase) {
      if (username === 'admin' && password === '123456') {
        const token = jwt.sign(
          { id: 1, username: 'admin', rol: 'admin' },
          process.env.JWT_SECRET || "clave_secreta",
          { expiresIn: "8h" }
        );
        
        return res.json({
          message: "Login exitoso (modo simulación)",
          token,
          user: { id: 1, username: 'admin', nombre: 'Administrador', rol: 'admin' }
        });
      }
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    // Modo Supabase
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('username', username)
      .eq('password', password);

    if (error) {
      console.error('Error Supabase:', error);
      return res.status(500).json({ message: "Error en la base de datos" });
    }

    if (!usuarios || usuarios.length === 0) {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    const user = usuarios[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol },
      process.env.JWT_SECRET || "clave_secreta",
      { expiresIn: "8h" }
    );

    res.json({
      message: "Login exitoso",
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        nombre: user.nombre,
        rol: user.rol 
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: "Error en la base de datos" });
  }
});

// ===================== MONTAJE DEL ROUTER =====================
app.use("/api", apiRouter);

// ===================== ERRORES =====================
app.use((err, req, res, next) => {
  console.error("❌ Error global:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ===================== INICIAR SERVIDOR =====================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en ejecución en puerto ${PORT}`);
  console.log(`🔍 JWT_SECRET: ${process.env.JWT_SECRET || "clave_secreta"}`);
  console.log(`🗄️  Base de datos: ${supabase ? "Supabase" : "Modo Simulación"}`);
});

export default app;