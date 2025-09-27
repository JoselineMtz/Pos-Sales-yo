import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Middleware CORS
const allowedOrigins = [
  'http://localhost:5173',
  'https://front-pos-khaki.vercel.app'
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

// Configuración de Supabase
let supabase = null;

const initializeSupabase = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('https://')) {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(supabaseUrl, supabaseKey);
      console.log('✅ Supabase configurado correctamente');
      return true;
    } else {
      console.log('⚠️ Supabase no configurado - Modo simulación activado');
      return false;
    }
  } catch (error) {
    console.log('⚠️ Error cargando Supabase:', error.message);
    return false;
  }
};

// Inicializar Supabase al iniciar
initializeSupabase();

// Middleware JWT
function verificarToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ message: "Token no proporcionado" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token no proporcionado" });

  jwt.verify(token, process.env.JWT_SECRET || "clave_secreta", (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido o expirado" });
    req.user = user;
    next();
  });
}

// Rutas
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

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
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    // Modo Supabase
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('username', username)
      .eq('password', password);

    if (error) return res.status(500).json({ message: "Error en la base de datos" });
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
      user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol }
    });

  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// Iniciar servidor SIEMPRE
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});

export default app;