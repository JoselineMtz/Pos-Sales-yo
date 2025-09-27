import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de Supabase con diagnóstico completo
let supabase = null;
let supabaseStatus = 'Inicializando...';
let supabaseDetails = '';

const initializeSupabase = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    console.log('=== DIAGNÓSTICO SUPABASE ===');
    console.log('URL:', supabaseUrl ? '✅ Presente' : '❌ Faltante');
    console.log('Key:', supabaseKey ? '✅ Presente' : '❌ Faltante');

    if (!supabaseUrl || !supabaseKey) {
      supabaseStatus = '❌ Variables faltantes';
      supabaseDetails = 'Configura SUPABASE_URL y SUPABASE_ANON_KEY en Render';
      return;
    }

    // Importar y crear cliente
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('✅ Cliente Supabase creado');

    // Probar conexión de varias maneras
    console.log('🔍 Probando conexión a Supabase...');
    
    // 1. Probar conexión básica
    const { data: testData, error: testError } = await supabase
      .from('usuarios')
      .select('count')
      .limit(1);

    if (testError) {
      if (testError.code === '42P01') {
        supabaseStatus = '❌ Tabla no existe';
        supabaseDetails = 'La tabla "usuarios" no existe en Supabase';
        console.log('❌ Error: Tabla usuarios no encontrada');
      } else if (testError.code === '42501') {
        supabaseStatus = '❌ Error de permisos RLS';
        supabaseDetails = 'Problema con Row Level Security. Revisa las políticas.';
        console.log('❌ Error RLS:', testError.message);
      } else {
        supabaseStatus = `❌ Error: ${testError.code}`;
        supabaseDetails = testError.message;
        console.log('❌ Error de Supabase:', testError);
      }
      return;
    }

    // 2. Probar contar usuarios
    const { count, error: countError } = await supabase
      .from('usuarios')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      supabaseStatus = '⚠️ Conexión parcial';
      supabaseDetails = `Conectado pero error en query: ${countError.message}`;
      console.log('⚠️ Error en count:', countError);
    } else {
      supabaseStatus = '✅ Conectado a PostgreSQL';
      supabaseDetails = `Tabla usuarios encontrada. Registros: ${count || 0}`;
      console.log(`✅ Tabla usuarios tiene ${count} registros`);
    }

  } catch (error) {
    supabaseStatus = `❌ Error crítico`;
    supabaseDetails = error.message;
    console.error('❌ Error inicializando Supabase:', error);
  }
};

// Inicializar inmediatamente
initializeSupabase();

// Rutas con diagnóstico completo
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    database: {
      status: supabaseStatus,
      details: supabaseDetails,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    database: {
      status: supabaseStatus,
      details: supabaseDetails
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    supabase: {
      url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ No configurada',
      key: process.env.SUPABASE_ANON_KEY ? '✅ Configurada' : '❌ No configurada',
      status: supabaseStatus,
      details: supabaseDetails
    },
    jwt: process.env.JWT_SECRET ? '✅ Configurada' : '❌ No configurada',
    timestamp: new Date().toISOString()
  });
});

// Login con diagnóstico mejorado
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        message: "Usuario y contraseña requeridos",
        database_status: supabaseStatus
      });
    }

    console.log(`🔐 Login attempt: ${username}, DB Status: ${supabaseStatus}`);

    // Si Supabase no está funcionando, usar modo simulación
    if (!supabase || !supabaseStatus.includes('✅')) {
      console.log('🔄 Usando modo simulación - Supabase no disponible');
      
      // Credenciales de simulación
      const validUsers = {
        'admin': { id: 1, nombre: 'Admin Simulado', rol: 'admin' },
        'vendedor': { id: 2, nombre: 'Vendedor Simulado', rol: 'vendedor' }
      };

      if (validUsers[username] && password === '123456') {
        const user = validUsers[username];
        const token = jwt.sign(
          { id: user.id, username: username, rol: user.rol },
          process.env.JWT_SECRET || "clave_secreta",
          { expiresIn: "8h" }
        );
        
        return res.json({
          message: `Login exitoso (Modo simulación - ${supabaseStatus})`,
          token,
          user: { 
            id: user.id, 
            username: username, 
            nombre: user.nombre,
            rol: user.rol 
          },
          database_status: supabaseStatus
        });
      }
      
      return res.status(401).json({ 
        message: "Credenciales incorrectas",
        database_status: supabaseStatus,
        hint: "En modo simulación usar: admin/123456 o vendedor/123456"
      });
    }

    // Login con Supabase real
    console.log('📊 Autenticando con Supabase real...');
    
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, username, nombre, rol')
      .eq('username', username)
      .eq('password', password);

    if (error) {
      console.error('❌ Error de Supabase:', error);
      return res.status(500).json({ 
        message: "Error en la base de datos",
        error: error.message,
        database_status: supabaseStatus
      });
    }

    if (!usuarios || usuarios.length === 0) {
      console.log('❌ Usuario no encontrado en BD real');
      return res.status(401).json({ 
        message: "Usuario o contraseña incorrectos en la base de datos real",
        database_status: supabaseStatus,
        hint: "Verifica que el usuario exista en la tabla 'usuarios' de Supabase"
      });
    }

    const user = usuarios[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol },
      process.env.JWT_SECRET || "clave_secreta",
      { expiresIn: "8h" }
    );

    console.log('✅ Login exitoso con BD real');
    
    res.json({
      message: "Login exitoso (Base de datos real)",
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        nombre: user.nombre,
        rol: user.rol 
      },
      database_status: supabaseStatus
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ 
      message: "Error interno del servidor",
      error: error.message,
      database_status: supabaseStatus
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`📊 Estado Supabase: ${supabaseStatus}`);
  console.log(`📋 Detalles: ${supabaseDetails}`);
});

export default app;