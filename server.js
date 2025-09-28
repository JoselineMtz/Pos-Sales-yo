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
let supabase = null;
let databaseStatus = 'Inicializando...';

const initializeSupabase = async () => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            databaseStatus = '❌ Variables faltantes';
            return;
        }

        supabase = createClient(supabaseUrl, supabaseKey);
        
        // Prueba de conexión simple
        const { error } = await supabase.from('productos').select('id').limit(1);
        
        if (error && error.code === '42P01') {
            databaseStatus = '❌ Tablas no creadas';
        } else if (error) {
            databaseStatus = `❌ Error: ${error.message}`;
        } else {
            databaseStatus = '✅ Conectado a Supabase';
        }

    } catch (error) {
        databaseStatus = `❌ Error: ${error.message}`;
    }
};

await initializeSupabase();

// ===================== MIDDLEWARE JWT =====================
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET || "clave_secreta", (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Token inválido" });
        }
        req.user = user;
        next();
    });
}

// ===================== STOCK ROUTER SIMPLIFICADO =====================
const createStockRouter = () => {
    const router = express.Router();

    // Middleware de permisos simplificado
    const checkPermission = (permission) => {
        return (req, res, next) => {
            if (req.user.rol === "admin") return next();
            // Para vendedores, por ahora permitimos todo
            if (req.user.rol === "vendedor") return next();
            res.status(403).json({ message: "Permisos insuficientes" });
        };
    };

    // ✅ RUTA DE PRUEBA
    router.get("/test", (req, res) => {
        res.json({ message: "✅ Stock router funcionando" });
    });

    // OBTENER PRODUCTOS
    router.get("/products", verifyToken, checkPermission('can_view_products'), async (req, res) => {
        try {
            const { data: products, error } = await supabase
                .from('productos')
                .select(`
                    *,
                    categorias (nombre)
                `)
                .order('id', { ascending: false });

            if (error) {
                console.error('Error Supabase:', error);
                return res.status(500).json({ error: "Error en base de datos" });
            }

            // Formatear respuesta para frontend
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

            res.json(formattedProducts);
        } catch (error) {
            console.error('Error general:', error);
            res.status(500).json({ error: "Error interno del servidor" });
        }
    });

    // OBTENER CATEGORÍAS
    router.get("/categories", verifyToken, async (req, res) => {
        try {
            const { data: categories, error } = await supabase
                .from('categorias')
                .select('*')
                .order('nombre');

            if (error) throw error;

            res.json(categories || []);
        } catch (error) {
            res.status(500).json({ error: "Error al obtener categorías" });
        }
    });

    // BUSCAR PRODUCTO POR SKU
    router.get("/products/by-sku/:sku", verifyToken, async (req, res) => {
        try {
            const { sku } = req.params;
            const { data: product, error } = await supabase
                .from('productos')
                .select(`
                    *,
                    categorias (nombre)
                `)
                .eq('sku', sku)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ message: "Producto no encontrado" });
                }
                throw error;
            }

            const formattedProduct = {
                id: product.id,
                sku: product.sku,
                name: product.name,
                description: product.description,
                price: product.price,
                stock: product.stock,
                stock_unit: product.stock_unit,
                categoria_id: product.categoria_id,
                categoria_nombre: product.categorias?.nombre
            };

            res.json(formattedProduct);
        } catch (error) {
            res.status(500).json({ error: "Error al buscar producto" });
        }
    });

    // CREAR/ACTUALIZAR PRODUCTO
    router.post("/products/upsert", verifyToken, async (req, res) => {
        try {
            const { sku, name, description, price, stock, stockUnit, user_id, categoria_id } = req.body;

            if (!sku || !name || !price || !stock) {
                return res.status(400).json({ message: "Datos incompletos" });
            }

            const productData = {
                sku,
                name,
                description: description || '',
                price: parseFloat(price),
                stock: parseFloat(stock),
                stock_unit: stockUnit || 'Unidad',
                user_id: user_id || req.user.id,
                categoria_id: categoria_id || null
            };

            // Verificar si existe
            const { data: existing } = await supabase
                .from('productos')
                .select('id')
                .eq('sku', sku)
                .single();

            let result;
            if (existing) {
                // Actualizar
                const { data, error } = await supabase
                    .from('productos')
                    .update(productData)
                    .eq('sku', sku)
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            } else {
                // Crear nuevo
                const { data, error } = await supabase
                    .from('productos')
                    .insert([productData])
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            }

            res.json({ 
                message: existing ? "Producto actualizado" : "Producto creado",
                product: result 
            });

        } catch (error) {
            console.error('Error en upsert:', error);
            res.status(500).json({ error: "Error al guardar producto" });
        }
    });

    // ELIMINAR PRODUCTO
    router.delete("/products/:id", verifyToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('productos')
                .delete()
                .eq('id', id);

            if (error) throw error;

            res.json({ message: "Producto eliminado" });
        } catch (error) {
            res.status(500).json({ error: "Error al eliminar producto" });
        }
    });

    // CREAR CATEGORÍA
    router.post("/categories", verifyToken, async (req, res) => {
        try {
            const { nombre } = req.body;
            
            if (!nombre) {
                return res.status(400).json({ message: "Nombre requerido" });
            }

            const { data: category, error } = await supabase
                .from('categorias')
                .insert([{ nombre }])
                .select()
                .single();

            if (error) throw error;

            res.json(category);
        } catch (error) {
            res.status(500).json({ error: "Error al crear categoría" });
        }
    });

    // ELIMINAR CATEGORÍA
    router.delete("/categories/:id", verifyToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('categorias')
                .delete()
                .eq('id', id);

            if (error) throw error;

            res.json({ message: "Categoría eliminada" });
        } catch (error) {
            res.status(500).json({ error: "Error al eliminar categoría" });
        }
    });

    return router;
};

// ===================== ROUTER PRINCIPAL =====================
const apiRouter = express.Router();

// ✅ RUTAS DE DIAGNÓSTICO
apiRouter.get("/test", (req, res) => {
    res.json({ 
        message: "✅ API funcionando",
        database: databaseStatus,
        timestamp: new Date().toISOString()
    });
});

apiRouter.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        database: databaseStatus,
        timestamp: new Date().toISOString()
    });
});

// ✅ LOGIN SIMPLIFICADO
apiRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // Login simple para testing
    const users = {
        'admin': { id: 1, nombre: 'Administrador', rol: 'admin' },
        'vendedor': { id: 2, nombre: 'Vendedor', rol: 'vendedor' }
    };

    if (users[username] && password === '123456') {
        const user = users[username];
        const token = jwt.sign(
            { id: user.id, username: username, rol: user.rol },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );
        
        return res.json({
            message: "Login exitoso",
            token,
            user: { id: user.id, username: username, nombre: user.nombre, rol: user.rol }
        });
    }
    
    res.status(401).json({ message: "Credenciales incorrectas" });
});

// ✅ MONTAR STOCK ROUTER
const stockRouter = createStockRouter();
apiRouter.use("/stock", stockRouter);

// Montar router principal
app.use("/api", apiRouter);

// Ruta raíz
app.get("/", (req, res) => {
    res.json({ 
        message: "🚀 Servidor POS funcionando",
        endpoints: {
            test: "/api/test",
            health: "/api/health", 
            login: "/api/login",
            stock: "/api/stock/*"
        },
        database: databaseStatus
    });
});

// Manejo de errores
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`📊 Estado: ${databaseStatus}`);
});

export default app;