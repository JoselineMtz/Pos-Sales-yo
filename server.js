import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Configuración CORS
app.use(cors());
app.use(express.json());

// Configuración de Supabase
let supabase = null;
let supabaseStatus = 'No configurado';

const initializeSupabase = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    console.log('🔧 Configurando Supabase...');
    console.log('URL:', supabaseUrl ? '✅ Configurada' : '❌ Faltante');
    console.log('Key:', supabaseKey ? '✅ Configurada' : '❌ Faltante');
    
    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('https://')) {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(supabaseUrl, supabaseKey);
      
      // Probar conexión
      const { data, error } = await supabase.from('usuarios').select('count').limit(1);
      
      if (error) {
        supabaseStatus = `Error: ${error.message}`;
        console.error('❌ Error conectando a Supabase:', error);
      } else {
        supabaseStatus = 'Conectado ✅';
        console.log('✅ Supabase conectado correctamente');
      }
    } else {
      supabaseStatus = 'No configurado - Modo simulación';
      console.log('⚠️  Supabase no configurado - Modo simulación activado');
    }
  } catch (error) {
    supabaseStatus = `Error: ${error.message}`;
    console.error('❌ Error inicializando Supabase:', error);
  }
};

// Inicializar Supabase al inicio
initializeSupabase();

// Ruta principal
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Health check mejorado
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'API funcionando correctamente',
    database: supabaseStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Ruta de login mejorada
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    console.log('🔐 Intento de login para:', username);

    // Si Supabase está configurado, usar base de datos real
    if (supabase && supabaseStatus.includes('Conectado')) {
      console.log('📊 Usando base de datos REAL');
      
      const { data: usuarios, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('username', username)
        .eq('password', password);

      if (error) {
        console.error('❌ Error de Supabase:', error);
        return res.status(500).json({ message: "Error en la base de datos" });
      }

      if (!usuarios || usuarios.length === 0) {
        console.log('❌ Credenciales incorrectas en BD real');
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
      }

      const user = usuarios[0];
      const token = jwt.sign(
        { id: user.id, username: user.username, rol: user.rol },
        process.env.JWT_SECRET || "clave_secreta",
        { expiresIn: "8h" }
      );

      console.log('✅ Login exitoso con BD real para:', username);
      
      return res.json({
        message: "Login exitoso (Base de datos real)",
        token,
        user: { 
          id: user.id, 
          username: user.username, 
          nombre: user.nombre,
          rol: user.rol 
        }
      });
    }

    // Modo simulación (fallback)
    console.log('🔄 Usando MODO SIMULACIÓN');
    
    if (username === 'admin' && password === '123456') {
      const token = jwt.sign(
        { id: 1, username: 'admin', rol: 'admin' },
        process.env.JWT_SECRET || "clave_secreta",
        { expiresIn: "8h" }
      );
      
      return res.json({
        message: "Login exitoso (Modo simulación)",
        token,
        user: { id: 1, username: 'admin', rol: 'admin' }
      });
    }

    return res.status(401).json({ message: "Usuario o contraseña incorrectos" });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// Ruta para verificar configuración
app.get('/api/config', (req, res) => {
  res.json({
    supabase: {
      url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ No configurada',
      key: process.env.SUPABASE_ANON_KEY ? '✅ Configurada' : '❌ No configurada',
      status: supabaseStatus
    },
    jwt: process.env.JWT_SECRET ? '✅ Configurada' : '❌ No configurada'
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`📊 Estado Supabase: ${supabaseStatus}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;