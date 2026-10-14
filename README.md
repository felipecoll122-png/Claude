# Mis Gastos

Una app web simple para registrar gastos desde el celular y ver un dashboard con el total del mes y el gasto por categoría. Sin backend: todo se guarda en el `localStorage` del navegador. Es instalable como PWA (funciona offline y se puede agregar a la pantalla de inicio).

## Uso local

No requiere build ni dependencias. Cualquier servidor estático sirve:

```bash
python3 -m http.server 8080
# o
npx serve .
```

Abrí `http://localhost:8080` en el navegador (o desde el celular, usando la IP de tu compu en la misma red).

## Instalar en el celular

1. Publicá la carpeta en un hosting estático (ver abajo) para tener una URL con HTTPS.
2. Abrí esa URL desde Chrome (Android) o Safari (iOS).
3. Elegí "Agregar a pantalla de inicio" / "Instalar app". Va a quedar como un ícono más, funcionando offline.

## Deploy gratis (GitHub Pages)

1. Hacé push de este repo a GitHub (rama `main`).
2. En Settings → Pages, elegí "Deploy from a branch" y la rama/carpeta raíz.
3. Usá la URL que te da GitHub Pages.

También funciona igual de bien en Netlify, Vercel o Cloudflare Pages arrastrando la carpeta.

## Funcionalidad

- Botón "+" para cargar un gasto: monto, categoría (8 categorías con ícono y color fijo) y nota opcional.
- Dashboard: total del mes, comparación contra el mes anterior, gasto por categoría (barras) y listado de movimientos agrupado por día.
- Navegación entre meses.
- Eliminar un gasto con opción de deshacer.
- Configuración: moneda y exportar/borrar los datos.

## Datos

Los gastos viven únicamente en el navegador (`localStorage`), por dispositivo. Para llevarlos a otro lado, usá "Exportar datos (JSON)" en Configuración.

## Mi Salud (pulsera JCVital)

JCVital no tiene una API pública, así que la integración funciona con capturas de pantalla: abrís `salud.html` (el ícono ❤️ arriba en Mis Gastos), subís las capturas del día, respondés un cuestionario corto y Claude analiza todo junto con tu historial.

- **Puntajes al estilo WHOOP:** Recuperación (0–100 %, verde/amarillo/rojo, comparada con tu propio promedio de HRV y FC en reposo), Rendimiento del sueño, Esfuerzo (0–21) y deuda de sueño.
- **Plan para hoy:** esfuerzo recomendado según tu recuperación, horas de sueño que necesitás y a qué hora acostarte (según la hora a la que te levantás).
- **Cuestionario diario (como el Journal de WHOOP):** alcohol, entrenamiento, cafeína a la tarde, cena, celular en la cama, siesta, comida, molestias, energía, estrés y ánimo. Claude además puede dejarte 1 o 2 preguntas personalizadas para el día siguiente.
- **Lo que dice tu historial:** cada análisis diario usa los últimos 14 días para sacar tendencias con números.
- **Impacto de tus hábitos:** se calcula en el teléfono cuánto cambia tu recuperación los días con y sin cada hábito (aparece con al menos 3 días de cada lado).
- **Conclusiones de tu historial:** desde los 5 días cargados, Claude revisa hasta 90 días juntos y te dice qué te hace bien, qué te juega en contra y un plan para la semana.
- **Clave de API:** en el ícono de perfil cargás una clave de la API de Claude (console.anthropic.com → API Keys). Se guarda solo en el navegador de ese dispositivo y se manda únicamente a `api.anthropic.com`. Cada análisis cuesta unos pocos centavos de dólar.
- **Historial:** se guardan los números, las respuestas y las evaluaciones (no las imágenes) en `localStorage`. Se puede exportar en JSON.
- Es orientativo y no reemplaza la consulta médica.
