import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    status: 'OK',
    database: supabase ? 'Supabase Conectado' : 'Modo Simulación',
    timestamp: new Date().toISOString()
  });
});

// Login que funciona con o sin Supabase
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Modo simulación si Supabase no está configurado
    if (!supabase) {
      if (username === 'admin' && password === 'admin') {
        const token = jwt.sign(
          { id: 1, username: 'admin', rol: 'admin' },
          process.env.JWT_SECRET || "clave_secreta",
          { expiresIn: "8h" }
        );
        
        return res.json({
          message: "Login exitoso (modo simulación)",
          token,
          user: { id: 1, username: 'admin', rol: 'admin' }
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

// Obtener productos
app.get('/api/productos', async (req, res) => {
  try {
    // Modo simulación
    if (!supabase) {
      return res.json([
        { id: 1, nombre: "Producto Demo 1", precio: 10.99, stock: 100 },
        { id: 2, nombre: "Producto Demo 2", precio: 15.50, stock: 50 },
        { id: 3, nombre: "Producto Demo 3", precio: 8.75, stock: 200 }
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

// Ruta de prueba
app.get('/api/test', (req, res) => {
  res.json({ 
    message: "✅ API funcionando correctamente",
    mode: supabase ? "Supabase Real" : "Modo Simulación",
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`🌐 Modo: ${supabase ? 'Supabase Conectado' : 'Simulación'}`);
});

export default app;