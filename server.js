import express from 'express';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configurar Supabase (usa variables de entorno)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Variables de Supabase no configuradas');
}

const supabase = createClient(supabaseUrl || 'db.xozlhiibvwbkrwhwdabe.supabase.co', supabaseKey || 'peluche1');

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS con Supabase',
    status: 'OK',
    database: supabaseUrl ? 'Conectado' : 'No configurado',
    timestamp: new Date().toISOString()
  });
});

// Login simplificado
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Simular login si Supabase no está configurado
    if (!supabaseUrl || !supabaseKey) {
      if (username === 'admin' && password === '123456') {
        return res.json({
          message: "Login exitoso (modo simulación)",
          token: "token_simulado",
          user: { id: 1, username: 'admin', rol: 'admin' }
        });
      } else {
        return res.status(401).json({ message: "Credenciales incorrectas" });
      }
    }

    // Login real con Supabase
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
      process.env.JWT_SECRET || "supabase_secret",
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
    if (!supabaseUrl || !supabaseKey) {
      return res.json([
        { id: 1, nombre: "Producto Demo", precio: 10.99, stock: 100 }
      ]);
    }

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
    message: "✅ API funcionando",
    supabase: supabaseUrl ? "Configurado" : "No configurado",
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`📊 Supabase: ${supabaseUrl ? 'Conectado' : 'Modo simulación'}`);
});

export default app;