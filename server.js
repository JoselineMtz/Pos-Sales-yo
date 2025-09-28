import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===================== CONEXIÓN SUPABASE =====================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Faltan variables de Supabase');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Cliente Supabase inicializado');

// ===================== MIDDLEWARE JWT =====================
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET || "clave_secreta");
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ message: "Token inválido o expirado" });
    }
}

// ===================== RUTA DE LOGIN MEJORADA =====================
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    console.log('🔐 Intento de login:', { username });

    if (!username || !password) {
        return res.status(400).json({ 
            message: "Usuario y contraseña requeridos" 
        });
    }

    try {
        // 1. Buscar usuario en la base de datos
        const { data: usuarios, error } = await supabase
            .from('usuarios')
            .select('id, username, password, nombre, rol')
            .eq('username', username)
            .eq('password', password);

        if (error) {
            console.error('❌ Error de Supabase:', error);
            return res.status(500).json({ 
                message: "Error en la base de datos",
                error: error.message 
            });
        }

        // 2. Verificar si se encontró el usuario
        if (!usuarios || usuarios.length === 0) {
            console.log('❌ Credenciales incorrectas para usuario:', username);
            return res.status(401).json({ 
                message: "Usuario o contraseña incorrectos" 
            });
        }

        const user = usuarios[0];
        console.log('✅ Usuario autenticado:', user.username, 'Rol:', user.rol);

        // 3. Generar token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                rol: user.rol,
                nombre: user.nombre 
            },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );

        // 4. Responder con éxito
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
        console.error('❌ Error en login:', error);
        res.status(500).json({ 
            message: "Error interno del servidor",
            error: error.message 
        });
    }
});

// ===================== STOCK ROUTER SIMPLIFICADO =====================
const stockRouter = express.Router();

// Middleware de permisos
const checkPermission = (permission) => {
    return (req, res, next) => {
        if (req.user.rol === "admin") return next();
        if (req.user.rol === "vendedor") return next(); // Por ahora permitimos todo
        res.status(403).json({ message: "Permisos insuficientes" });
    };
};

// RUTA DE PRUEBA DEL STOCK ROUTER
stockRouter.get("/test", verifyToken, (req, res) => {
    res.json({ 
        message: "✅ Stock router funcionando",
        user: req.user 
    });
});

// OBTENER CATEGORÍAS
stockRouter.get("/categories", verifyToken, async (req, res) => {
    try {
        console.log('📦 Obteniendo categorías...');
        
        const { data: categories, error } = await supabase
            .from('categorias')
            .select('*')
            .order('nombre');

        if (error) {
            console.error('Error al obtener categorías:', error);
            return res.status(500).json({ error: "Error en base de datos" });
        }

        console.log('✅ Categorías obtenidas:', categories?.length || 0);
        res.json(categories || []);
        
    } catch (error) {
        console.error('Error general en categories:', error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// OBTENER PRODUCTOS
stockRouter.get("/products", verifyToken, async (req, res) => {
    try {
        console.log('📦 Obteniendo productos...');
        
        const { data: products, error } = await supabase
            .from('productos')
            .select(`
                *,
                categorias (nombre)
            `)
            .order('id', { ascending: false });

        if (error) {
            console.error('Error al obtener productos:', error);
            return res.status(500).json({ error: "Error en base de datos" });
        }

        // Formatear respuesta
        const formattedProducts = products.map(product => ({
            id: product.id,
            sku: product.sku,
            name: product.name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            stock_unit: product.stock_unit,
            categoria_id: product.categoria_id,
            categoria_nombre: product.categorias?.nombre,
            user_id: product.user_id
        }));

        console.log('✅ Productos obtenidos:', formattedProducts.length);
        res.json(formattedProducts);
        
    } catch (error) {
        console.error('Error general en products:', error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===================== RUTAS DE DIAGNÓSTICO =====================
app.get("/api/test", (req, res) => {
    res.json({ 
        message: "✅ API funcionando correctamente",
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health", async (req, res) => {
    try {
        // Probar conexión a Supabase
        const { data, error } = await supabase
            .from('usuarios')
            .select('count')
            .limit(1);

        res.json({ 
            status: "OK",
            database: error ? "Error" : "Conectado",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({ 
            status: "OK", 
            database: "Error",
            timestamp: new Date().toISOString()
        });
    }
});

// ===================== MONTAJE DE RUTAS =====================
app.use("/api/stock", stockRouter);

// Ruta raíz
app.get("/", (req, res) => {
    res.json({ 
        message: "🚀 Servidor POS funcionando",
        endpoints: {
            test: "/api/test",
            health: "/api/health",
            login: "/api/login (POST)",
            stock: "/api/stock/*"
        }
    });
});

// Manejo de errores
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// ===================== INICIAR SERVIDOR =====================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`📊 Endpoints disponibles:`);
    console.log(`   → http://localhost:${PORT}/api/test`);
    console.log(`   → http://localhost:${PORT}/api/health`);
    console.log(`   → http://localhost:${PORT}/api/login (POST)`);
    console.log(`   → http://localhost:${PORT}/api/stock/*`);
});