import express from "express";

const createStockRouter = (supabase, verifyToken = (req, res, next) => next()) => {
  const router = express.Router();

  // ===================== MIDDLEWARE DE VERIFICACIÓN DE PERMISOS =====================
  const verificarPermisosStock = (permisoRequerido) => {
    return async (req, res, next) => {
      console.log("🔍 Verificando permisos para stock:", req.user);
      
      if (req.user.rol === "admin") {
        console.log("✅ Usuario es admin, acceso concedido");
        return next();
      }
      
      if (req.user.rol === "vendedor") {
        try {
          // Consulta a Supabase para obtener permisos del vendedor
          const { data: permisos, error } = await supabase
            .from('user_permissions')
            .select('permissions')
            .eq('user_id', req.user.id)
            .single();

          let userPermissions = {};
          
          if (!error && permisos) {
            userPermissions = permisos.permissions;
          } else {
            // Permisos por defecto si no se encuentran en la BD
            userPermissions = {
              can_view_products: true,
              can_edit_products: false,
              can_delete_products: false,
              can_create_products: false,
              can_view_sales: true,
              can_create_sales: true,
              can_view_customers: true,
              can_edit_customers: false,
              can_view_reports: false,
              can_manage_stock: false
            };
          }
          
          console.log("🔍 Permisos del usuario para stock:", userPermissions);
          
          if (userPermissions[permisoRequerido]) {
            console.log(`✅ Permiso '${permisoRequerido}' concedido para stock`);
            next();
          } else {
            console.log(`❌ Permiso '${permisoRequerido}' denegado para stock`);
            res.status(403).json({ 
              message: "No tienes permisos para realizar esta acción",
              requiredPermission: permisoRequerido
            });
          }
        } catch (error) {
          console.error("Error al verificar permisos:", error);
          return res.status(500).json({ error: "Error interno del servidor" });
        }
      } else {
        console.log(`❌ Rol no reconocido: ${req.user.rol}`);
        res.status(403).json({ message: "Acceso denegado" });
      }
    };
  };

  // ===================== PRODUCTOS =====================
  router.get("/products", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    try {
      const { data: productos, error } = await supabase
        .from('productos')
        .select(`
          *,
          categorias:categoria_id (nombre)
        `)
        .order('id', { ascending: false });

      if (error) throw error;

      // Formatear la respuesta para que sea compatible con el frontend
      const productosFormateados = productos.map(producto => ({
        ...producto,
        categoria_nombre: producto.categorias?.nombre || null
      }));

      res.json(productosFormateados);
    } catch (err) {
      console.error("Error al obtener productos:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.get("/products/by-sku/:sku", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    const { sku } = req.params;
    try {
      const { data: producto, error } = await supabase
        .from('productos')
        .select(`
          *,
          categorias:categoria_id (nombre)
        `)
        .eq('sku', sku)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // Código de Supabase para "No encontrado"
          return res.status(404).json({ message: "Producto no encontrado" });
        }
        throw error;
      }

      const productoFormateado = {
        ...producto,
        categoria_nombre: producto.categorias?.nombre || null
      };

      res.json(productoFormateado);
    } catch (err) {
      console.error("Error al obtener producto por SKU:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== CATEGORÍAS =====================
  router.get("/categories", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    try {
      const { data: categorias, error } = await supabase
        .from('categorias')
        .select('*')
        .order('nombre');

      if (error) throw error;
      res.json(categorias || []);
    } catch (err) {
      console.error("Error al obtener categorías:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.post("/categories", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ message: "El nombre de la categoría es requerido" });
    }
    try {
      const { data: categoria, error } = await supabase
        .from('categorias')
        .insert([{ nombre }])
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(categoria);
    } catch (err) {
      console.error("Error al crear categoría:", err);
      if (err.code === '23505') { // Violación de unique constraint
        return res.status(400).json({ message: "Ya existe una categoría con ese nombre" });
      }
      res.status(500).json({ error: "Error de servidor" });
    }
  });
  
  // ===================== UPSERT PRODUCTO (CREAR O ACTUALIZAR) =====================
  router.post("/products/upsert", verifyToken, async (req, res, next) => {
    // La verificación de permisos se hace dentro de la ruta
    // para manejar la lógica de "crear" vs "editar".
    console.log("🔍 DEBUG - Datos recibidos en upsert:", req.body);
    
    const { sku, name, description, price, stock, stockUnit, categoria_id, purchase_price } = req.body;

    if (!sku) {
      return res.status(400).json({ message: "El SKU del producto es requerido" });
    }

    try {
      const { data: productoExistente } = await supabase
        .from('productos')
        .select('id')
        .eq('sku', sku)
        .single();

      // Determina el permiso necesario: si existe se edita, si no, se crea.
      const permisoRequerido = productoExistente ? "can_edit_products" : "can_create_products";
      
      // Ejecuta el middleware de permisos manualmente
      verificarPermisosStock(permisoRequerido)(req, res, async () => {
        const productoData = {
          sku,
          name: name || '',
          description: description || '',
          price: parseFloat(price) || 0,
          stock: parseFloat(stock) || 0,
          stock_unit: stockUnit || 'Unidad',
          user_id: req.user.id,
          categoria_id: categoria_id || null,
          last_updated: new Date(),
          purchase_price: purchase_price || 0,
        };

        let resultado;
        if (productoExistente) {
          // Actualizar producto existente
          const { data, error } = await supabase
            .from('productos')
            .update(productoData)
            .eq('sku', sku)
            .select()
            .single();
          if (error) throw error;
          resultado = { ...data, message: "Producto actualizado" };
        } else {
          // Crear nuevo producto
          const { data, error } = await supabase
            .from('productos')
            .insert([productoData])
            .select()
            .single();
          if (error) throw error;
          resultado = { ...data, message: "Producto creado" };
        }
        res.json(resultado);
      });
    } catch (err) {
      console.error("Error en upsert producto:", err);
      if (err.code === '23505') {
        return res.status(400).json({ message: "Ya existe un producto con ese SKU" });
      }
      res.status(500).json({ error: "Error de servidor al procesar producto" });
    }
  });

  // ===================== ELIMINAR PRODUCTO =====================
  router.delete("/products/:id", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { id } = req.params;
    try {
      const { data, error } = await supabase
        .from('productos')
        .delete()
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }
      res.json({ message: "Producto eliminado correctamente" });
    } catch (err) {
      console.error("Error al eliminar producto:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  return router;
};

export default createStockRouter;