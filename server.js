import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Middleware CORS para Vercel + desarrollo
const allowedOrigins = [
  'http://localhost:5173',
  'https://front-pos-khaki.vercel.app',
  'https://tu-frontend.vercel.app' // Reemplaza con tu dominio real
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

// Configuración segura de Supabase
let supabase = null;
try {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  
  if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('https://')) {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase configurado correctamente');
  } else {
    console.log('⚠️  Supabase no configurado - Modo simulación activado');
  }
} catch (error) {
  console.log('⚠️  Error cargando Supabase:', error.message);
}

// ===================== MIDDLEWARE JWT =====================
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

// ===================== RUTAS PRINCIPALES =====================

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    status: 'OK',
    database: supabase ? 'Supabase Conectado' : 'Modo Simulación',
    timestamp: new Date().toISOString()
  });
});

// Health check de API
app.get('/api/health', (req, res) => {
  res.json({
    message: "Servidor funcionando correctamente",
    timestamp: new Date().toISOString(),
    database: supabase ? 'Conectado' : 'Simulación',
  });
});

// ===================== RUTA DE LOGIN =====================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Modo simulación si Supabase no está configurado
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
      } else {
        return res.status(401).json({ message: "Credenciales incorrectas" });
      }
    }

    // Modo real con Supabase
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
      return res.status(401).json({ message: "Credenciales incorrectas" });
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
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// ===================== RUTAS DE PRODUCTOS =====================
app.get('/api/productos', verificarToken, async (req, res) => {
  try {
    // Modo simulación
    if (!supabase) {
      return res.json([
        { id: 1, nombre: "Producto Demo 1", precio: 10.99, stock: 100, codigo: "PROD001" },
        { id: 2, nombre: "Producto Demo 2", precio: 15.50, stock: 50, codigo: "PROD002" },
        { id: 3, nombre: "Producto Demo 3", precio: 8.75, stock: 200, codigo: "PROD003" }
      ]);
    }

    // Modo real con Supabase
    const { data: productos, error } = await supabase
      .from('productos')
      .select('*')
      .order('nombre');

    if (error) throw error;

    res.json(productos || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================== RUTAS DE CLIENTES =====================
app.get('/api/clientes', verificarToken, async (req, res) => {
  try {
    // Modo simulación
    if (!supabase) {
      return res.json([
        { id: 1, nombre: "Cliente Demo 1", telefono: "123456789", saldo_pendiente: 0 },
        { id: 2, nombre: "Cliente Demo 2", telefono: "987654321", saldo_pendiente: 150.75 }
      ]);
    }

    // Modo real con Supabase
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

// Clientes con deuda
app.get('/api/clientes/con-deuda', verificarToken, async (req, res) => {
  try {
    // Modo simulación
    if (!supabase) {
      return res.json([
        { id: 2, nombre: "Cliente Demo 2", telefono: "987654321", saldo_pendiente: 150.75 }
      ]);
    }

    // Modo real con Supabase
    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, saldo_pendiente')
      .gt('saldo_pendiente', 0)
      .order('nombre');

    if (error) throw error;

    res.json(clientes || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes con deuda" });
  }
});

// Crear cliente
app.post('/api/clientes', verificarToken, async (req, res) => {
  const { rut, nombre, telefono, email, direccion } = req.body;

  if (!nombre || !telefono) {
    return res.status(400).json({ message: "Nombre y teléfono son obligatorios" });
  }

  try {
    // Modo simulación
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

    // Modo real con Supabase
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
app.get('/api/usuarios', verificarToken, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ message: "Solo los administradores pueden ver usuarios" });
  }

  try {
    // Modo simulación
    if (!supabase) {
      return res.json([
        { id: 1, username: 'admin', nombre: 'Administrador', rol: 'admin' }
      ]);
    }

    // Modo real con Supabase
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, username, nombre, rol');

    if (error) throw error;

    res.json(usuarios || []);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===================== RUTAS DE VENTAS =====================
app.post('/api/ventas', verificarToken, async (req, res) => {
  try {
    const { cliente_id, productos, total } = req.body;

    // Modo simulación
    if (!supabase) {
      return res.json({ 
        message: "Venta registrada exitosamente (simulación)",
        venta_id: Math.random() 
      });
    }

    // Modo real con Supabase
    const { data: venta, error: errorVenta } = await supabase
      .from('ventas')
      .insert([{ cliente_id, total }])
      .select();

    if (errorVenta) throw errorVenta;

    // Crear detalles de venta
    const detalles = productos.map(p => ({
      venta_id: venta[0].id,
      producto_id: p.id,
      cantidad: p.cantidad,
      precio_unitario: p.precio
    }));

    const { error: errorDetalles } = await supabase
      .from('detalles_venta')
      .insert(detalles);

    if (errorDetalles) throw errorDetalles;

    res.json({ 
      message: "Venta registrada exitosamente",
      venta_id: venta[0].id 
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================== RUTA DE PRUEBA =====================
app.get('/api/test', (req, res) => {
  res.json({ 
    message: "✅ API funcionando correctamente",
    mode: supabase ? "Supabase Real" : "Modo Simulación",
    timestamp: new Date().toISOString()
  });
});

// ===================== MANEJO DE ERRORES =====================
app.use((err, req, res, next) => {
  console.error("❌ Error global:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ===================== INICIAR SERVIDOR =====================
const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor en ejecución en http://localhost:${PORT}`);
    console.log(`🌐 Modo: ${supabase ? 'Supabase Conectado' : 'Simulación'}`);
  });
}

export default app;