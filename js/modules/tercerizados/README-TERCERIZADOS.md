# MÓDULO: SEGUIMIENTO DE TERCERIZADOS

## Archivos entregados

```
css/
  tercerizados.css          ← estilos del módulo (agregar como <link>)

js/modules/tercerizados/
  tercerizados.js           ← lógica completa del módulo
  tercerizados-init.js      ← inicializador / puente (NO toca app.js)

index.html                  ← index modificado (ver cambios abajo)
```

---

## Cambios en index.html

Se agregaron **3 cosas** al `index.html` original:

### 1. CSS del módulo (en `<head>`)
```html
<link rel="stylesheet" href="css/tercerizados.css?v=1" />
```

### 2. Ítem de menú (en `<nav class="sidebar-nav">`)
```html
<button class="nav-link terc-nav-link" data-section="tercerizados">Tercerizados</button>
```
> La clase `terc-nav-link` se usa para mostrarlo/ocultarlo por rol.
> El comportamiento de navegación lo hereda del sistema existente (app.js ya escucha todos los `.nav-link`).

### 3. Sección HTML (antes de `section-backup`)
```html
<section id="section-tercerizados" class="section">
  <div id="terc-root">…</div>
</section>
```

### 4. Script de inicialización (al final del `<body>`)
```html
<script type="module" src="js/modules/tercerizados/tercerizados-init.js?v=1"></script>
```

---

## Firestore: colecciones

### Nueva: `seguimiento_tercerizados`
Cada documento representa un pedido completo:

```json
{
  "estado": "pendiente_preparacion",
  "observacion": "...",
  "usuario_creador": "email@...",
  "usuario_creador_nombre": "...",
  "fecha_creacion": Timestamp,

  "items": [
    {
      "producto_id": "abc123",
      "producto_nombre": "Varilla 6mm",
      "cantidad_solicitada": 100,
      "observacion_item": "",
      "cantidad_preparada": 95,           // se agrega en paso 2
      "ingresos": [                        // se agrega en paso 4
        {
          "ok": 90,
          "falladas": 5,
          "faltantes": 0,
          "motivo_falla": "rotas",
          "fecha": "2026-04-28T10:00:00Z"
        }
      ]
    }
  ],

  "historial": [
    {
      "tipo": "creacion",
      "fecha": "ISO string",
      "usuario": "email",
      "usuario_nombre": "Nombre",
      "detalle": "..."
    }
  ],

  "fecha_preparacion": Timestamp,          // se agrega en paso 2
  "usuario_preparacion": "...",

  "chofer": "...",                         // se agrega en paso 3
  "fecha_salida": "dd/mm/yyyy",
  "hora_salida": "HH:mm",
  "usuario_salida": "...",
  "usuario_salida_nombre": "..."
}
```

### Estados del pedido
| Estado                  | Descripción                                      |
|-------------------------|--------------------------------------------------|
| `pendiente_preparacion` | Creado por Morón, esperando control de calidad   |
| `preparado_completo`    | Control de calidad preparó todo                  |
| `preparado_incompleto`  | Preparó parcialmente                             |
| `enviado`               | Morón dio salida con chofer                      |
| `pendiente_completar`   | Ingreso parcial, faltan unidades                 |
| `con_fallas`            | Hay unidades con fallas                          |
| `cerrado`               | Todo recibido correctamente                      |

---

## Reglas Firestore sugeridas

Agregá estas reglas a tu `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ... tus reglas existentes ...

    // Módulo tercerizados
    match /seguimiento_tercerizados/{docId} {

      // Lectura: cualquier usuario autenticado con rol permitido
      allow read: if request.auth != null
        && get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol
           in ['moron', 'control_calidad', 'gerencia'];

      // Crear: moron y gerencia
      allow create: if request.auth != null
        && get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol
           in ['moron', 'gerencia'];

      // Actualizar: todos los roles permitidos (cada uno en su paso)
      allow update: if request.auth != null
        && get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol
           in ['moron', 'control_calidad', 'gerencia'];
    }
  }
}
```

> **Nota:** Si tus reglas actuales usan `uid` en lugar de `email` para buscar el perfil, adaptá la ruta.

---

## Agregar el rol `control_calidad`

En la colección `usuarios`, al crear o editar un usuario de control de calidad, simplemente asignale:

```json
{
  "rol": "control_calidad",
  "nombre": "...",
  "email": "...",
  "activo": true
}
```

No necesitás modificar nada más en el sistema. El módulo detecta el rol automáticamente.

---

## Flujo completo

```
1. MORÓN crea pedido
   → estado: pendiente_preparacion

2. CONTROL DE CALIDAD prepara
   → carga cantidad_preparada por producto
   → estado: preparado_completo / preparado_incompleto

3. MORÓN da salida
   → ingresa nombre del chofer
   → estado: enviado (con fecha y hora automáticas)

4. MORÓN registra ingreso (puede ser múltiples veces)
   → carga ok / falladas / faltantes por producto
   → estado automático:
       cerrado              (todo recibido sin fallas)
       pendiente_completar  (faltan unidades)
       con_fallas           (hay unidades falladas)

5. Gerencia puede ver TODO en tiempo real
```

---

## Sin tocar app.js ✅

El módulo funciona 100% independiente:
- `tercerizados-init.js` escucha `onAuthStateChanged` en paralelo a `app.js`
- Usa `MutationObserver` para detectar cuando la sección se activa (app.js la activa)
- No interfiere con ningún estado, variable ni función de app.js
