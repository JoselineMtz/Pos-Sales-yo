import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();

// Configuración CORS
app.use(cors());
app.use(express.json());

// ✅ RUTA PRINCIPAL (ésta funciona)
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ API POS funcionando',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// ✅ RUTA DE HEALTH CHECK BAJO /api (ésta falta)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Healthy', 
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// ✅ RUTA DE LOGIN (IMPORTANTE)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Aquí tu lógica de login...
    // Modo simulación por ahora
    if (username === 'admin' && password === '123456') {
      const token = jwt.sign(
        { id: 1, username: 'admin', rol: 'admin' },
        process.env.JWT_SECRET || "clave_secreta",
        { expiresIn: "8h" }
      );
      
      return res.json({
        message: "Login exitoso",
        token,
        user: { id: 1, username: 'admin', rol: 'admin' }
      });
    }

    return res.status(401).json({ message: "Credenciales incorrectas" });

  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});

export default app;