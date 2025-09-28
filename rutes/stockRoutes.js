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
          // Consulta a Supabase para obtener permisos
          const { data: permisos, error } = await supabase
            .from('user_permissions')
            .select('permissions')
            .eq('user_id', req.user.id)
            .single();

          let userPermissions = {};
          
          if (!error && permisos) {
            userPermissions = permisos.permissions;
          } else {
            // Permisos por defecto si no se encuentran
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
            console.log(`✅ Permiso ${permisoRequerido} concedido para stock`);
            next();
          } else {
            console.log(`❌ Permiso ${permisoRequerido} denegado para stock`);
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
      const { data: productos, error } = await supabase
        .from('productos')
        .select(`
          *,
          categorias:categoria_id (nombre)
        `)
        .eq('sku', sku)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No encontrado
          return res.status(404).json({ message: "Producto no encontrado" });
        }
        throw error;
      }

      // Formatear la respuesta
      const productoFormateado = {
        ...productos,
        categoria_nombre: productos.categorias?.nombre || null
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

  router.delete("/categories/:id", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { id } = req.params;
    
    try {
      // Verificar si la categoría existe
      const { data: categoria, error: errorCategoria } = await supabase
        .from('categorias')
        .select('id')
        .eq('id', id)
        .single();

      if (errorCategoria) {
        return res.status(404).json({ message: "Categoría no encontrada" });
      }

      // Eliminar productos asociados primero
      const { error: errorProductos } = await supabase
        .from('productos')
        .delete()
        .eq('categoria_id', id);

      if (errorProductos) {
        console.error("Error al eliminar productos asociados:", errorProductos);
      }

      // Eliminar categoría
      const { error: errorEliminar } = await supabase
        .from('categorias')
        .delete()
        .eq('id', id);

      if (errorEliminar) throw errorEliminar;

      res.json({
        message: "Categoría y productos asociados eliminados correctamente",
      });
    } catch (err) {
      console.error("Error al eliminar categoría:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== UPSERT PRODUCTO =====================
  router.post("/products/upsert", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    console.log("🔍 DEBUG - Datos recibidos en upsert:", req.body);
    
    const { sku, name, description, price, stock, stockUnit, user_id, categoria_id, purchase_price } = req.body;
    const last_updated = new Date();

    if (!sku) {
      return res.status(400).json({ message: "El SKU del producto es requerido" });
    }

    try {
      // Verificar permisos específicos
      const { data: productoExistente, error: errorExistente } = await supabase
        .from('productos')
        .select('id')
        .eq('sku', sku)
        .single();

      const permisoRequerido = productoExistente ? "can_edit_products" : "can_create_products";
      
      // Verificar permisos para vendedores
      if (req.user.rol === "vendedor") {
        const { data: permisos, error: errorPermisos } = await supabase
          .from('user_permissions')
          .select('permissions')
          .eq('user_id', req.user.id)
          .single();

        let userPermissions = {};
        if (!errorPermisos && permisos) {
          userPermissions = permisos.permissions;
        } else {
          userPermissions = {
            can_view_products: true,
            can_edit_products: false,
            can_delete_products: false,
            can_create_products: false
          };
        }
        
        if (!userPermissions[permisoRequerido]) {
          const accion = productoExistente ? "editar" : "crear";
          return res.status(403).json({ 
            message: `No tienes permisos para ${accion} productos`,
            requiredPermission: permisoRequerido
          });
        }
      }

      // Preparar datos del producto
      const productoData = {
        sku,
        name: name || '',
        description: description || '',
        price: parseFloat(price) || 0,
        stock: parseFloat(stock) || 0,
        stock_unit: stockUnit || 'Unidad',
        user_id: user_id || req.user.id,
        categoria_id: categoria_id || null,
        last_updated,
        purchase_price: purchase_price || (parseFloat(price) * 0.7) || 0
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
        if (!name || !price || stock === undefined) {
          return res.status(400).json({ message: "Faltan datos requeridos para crear un nuevo producto" });
        }

        const { data, error } = await supabase
          .from('productos')
          .insert([productoData])
          .select()
          .single();

        if (error) throw error;
        resultado = { ...data, message: "Producto creado" };
      }

      res.json(resultado);
      
    } catch (err) {
      console.error("Error en upsert producto:", err);
      
      if (err.code === '23505') { // Violación de unique constraint
        return res.status(400).json({ message: "Ya existe un producto con ese SKU" });
      }
      
      res.status(500).json({ error: "Error de servidor al procesar producto" });
    }
  });

  // ===================== ELIMINAR PRODUCTO =====================
  router.delete("/products/:id", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { id } = req.params;
    
    try {
      const { error, count } = await supabase
        .from('productos')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // En Supabase no tenemos un count directo, verificamos si existía
      const { data: producto } = await supabase
        .from('productos')
        .select('id')
        .eq('id', id)
        .single();

      if (producto) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }

      res.json({ message: "Producto eliminado correctamente" });
    } catch (err) {
      console.error("Error al eliminar producto:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== PRODUCTOS TEMPORALES (opcional) =====================
  router.get("/temp-products/:sessionId", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    const { sessionId } = req.params;
    
    try {
      const { data: productos, error } = await supabase
        .from('temp_productos')
        .select('*')
        .eq('session_id', sessionId);

      if (error) throw error;

      res.json(productos || []);
    } catch (err) {
      console.error("Error al obtener productos temporales:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  return router;
};

export default createStockRouter;