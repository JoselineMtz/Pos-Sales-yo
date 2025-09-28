import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// Por seguridad, es mejor limitar CORS a tu dominio de Vercel
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*', // Usa una variable de entorno para la URL de tu frontend
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// ===================== CONEXIÓN SUPABASE =====================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Faltan variables de Supabase (URL o ANON_KEY)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Cliente Supabase inicializado con llave anónima');

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

// ===================== RUTA DE LOGIN =====================
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    try {
        const { data: usuarios, error } = await supabase
            .from('usuarios')
            .select('id, username, password, nombre, rol')
            .eq('username', username)
            .eq('password', password); // NOTA: Guardar contraseñas en texto plano es muy inseguro.

        if (error) throw error;

        if (!usuarios || usuarios.length === 0) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
        }

        const user = usuarios[0];
        const token = jwt.sign(
            { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login exitoso",
            token,
            user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ message: "Error interno del servidor", error: error.message });
    }
});

// ===================== STOCK ROUTER COMPLETO =====================
const stockRouter = express.Router();

// OBTENER TODOS LOS PRODUCTOS
stockRouter.get("/products", verifyToken, async (req, res) => {
    try {
        console.log('📦 Obteniendo productos...');
        const { data: products, error } = await supabase
            .from('productos')
            .select(`*, categorias:categoria_id (nombre)`)
            .order('id', { ascending: false });

        if (error) throw error;

        const formattedProducts = products.map(p => ({
            ...p,
            categoria_nombre: p.categorias?.nombre || null,
        }));

        console.log('✅ Productos obtenidos:', formattedProducts.length);
        res.json(formattedProducts);
    } catch (error) {
        console.error('Error en GET /products:', error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// OBTENER PRODUCTO POR SKU (AÑADIDA)
stockRouter.get("/products/by-sku/:sku", verifyToken, async (req, res) => {
    const { sku } = req.params;
    try {
        const { data: product, error } = await supabase
            .from('productos')
            .select(`*, categorias:categoria_id (nombre)`)
            .eq('sku', sku)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ message: "Producto no encontrado" });
            throw error;
        }

        const formattedProduct = {
            ...product,
            categoria_nombre: product.categorias?.nombre || null,
        };
        res.json(formattedProduct);
    } catch (err) {
        console.error("Error al obtener producto por SKU:", err);
        res.status(500).json({ error: "Error de servidor" });
    }
});


// OBTENER CATEGORÍAS
stockRouter.get("/categories", verifyToken, async (req, res) => {
    try {
        console.log('📦 Obteniendo categorías...');
        const { data: categories, error } = await supabase.from('categorias').select('*').order('nombre');
        if (error) throw error;
        console.log('✅ Categorías obtenidas:', categories?.length || 0);
        res.json(categories || []);
    } catch (error) {
        console.error('Error en GET /categories:', error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// FINALIZAR STOCK (AÑADIDA Y ESENCIAL)
stockRouter.post("/finalize", verifyToken, async (req, res) => {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ message: "No se proporcionaron productos para finalizar." });
    }

    try {
        const results = [];
        for (const product of products) {
            const { data: existingProduct } = await supabase
                .from('productos')
                .select('id, stock')
                .eq('sku', product.sku)
                .single();

            if (existingProduct) {
                const newStock = parseFloat(existingProduct.stock) + parseFloat(product.added_stock);
                const { data: updated, error } = await supabase
                    .from('productos')
                    .update({
                        name: product.name,
                        price: product.price,
                        purchase_price: product.purchase_price,
                        stock: newStock,
                        last_updated: new Date(),
                    })
                    .eq('id', existingProduct.id).select().single();
                if(error) throw error;
                results.push({ sku: product.sku, status: 'updated', data: updated });
            } else {
                const { data: created, error } = await supabase
                    .from('productos')
                    .insert([{
                        ...product,
                        stock: product.added_stock,
                        user_id: req.user.id,
                        last_updated: new Date(),
                    }])
                    .select().single();
                if(error) throw error;
                results.push({ sku: product.sku, status: 'created', data: created });
            }
        }
        res.status(200).json({ message: "Proceso de stock finalizado.", results });
    } catch (err) {
        console.error("Error al finalizar el stock:", err);
        res.status(500).json({ error: "Error de servidor al finalizar el stock." });
    }
});


// ===================== MONTAJE DE RUTAS =====================
app.use("/api/stock", stockRouter);

app.get("/", (req, res) => {
    res.json({ message: "🚀 Servidor POS funcionando" });
});

// Manejo de 404
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// ===================== INICIAR SERVIDOR =====================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});