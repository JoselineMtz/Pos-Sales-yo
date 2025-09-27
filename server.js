import express from "express";
import pkg from 'pg';
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

const { Pool } = pkg;

// Configurar dotenv solo en desarrollo
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();

// Configuración CORS simplificada para Vercel
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'https://front-pos-khaki.vercel.app',
    'https://pos-sales-*.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Middleware para logging mejorado
app.use((req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`🌐 Origin: ${req.headers.origin}`);
  next();
});

// Manejar preflight requests explícitamente
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(204).send();
});

// Conexión a PostgreSQL para Vercel
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Verificar conexión a la base de datos
pool.on('connect', () => {
  console.log("✅ Conectado a PostgreSQL");
});

pool.on('error', (err) => {
  console.error("❌ Error de conexión PostgreSQL:", err);
});

// Health check básico en la raíz
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API POS funcionando en Vercel', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DB_NAME || 'ventas_bd'
  });
});

// Health check de API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: 'Connected'
  });
});

// Ruta de login simplificada y funcional
app.post('/api/login', async (req, res) => {
  try {
    console.log("🔐 Intento de login:", req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Verificar credenciales
    const result = await pool.query(
      "SELECT id, username, nombre, rol FROM usuarios WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (result.rows.length === 0) {
      console.log("❌ Login fallido para:", username);
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        rol: user.rol 
      },
      process.env.JWT_SECRET || "clave_secreta_fallback",
      { expiresIn: "8h" }
    );

    console.log("✅ Login exitoso para:", username);
    
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
    console.error("❌ Error en login:", error);
    res.status(500).json({ 
      message: "Error interno del servidor",
      error: error.message 
    });
  }
});

// Ruta de prueba para verificar que las rutas están funcionando
app.get('/api/test', (req, res) => {
  res.json({
    message: "✅ Ruta de prueba funcionando",
    timestamp: new Date().toISOString(),
    cors: {
      origin: req.headers.origin,
      allowed: true
    }
  });
});

// Manejo de rutas no encontradas
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: "Ruta API no encontrada",
    path: req.originalUrl,
    availableRoutes: ['/api/health', '/api/login', '/api/test']
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error global:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: err.message 
  });
});

// Configuración del puerto solo para desarrollo local
const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`🔧 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️ Base de datos: ${process.env.DB_NAME || 'ventas_bd'}`);
  });
}

// Export default para Vercel
export default app;