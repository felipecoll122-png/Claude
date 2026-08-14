# Mi Rutina

Una app web simple para registrar tus entrenamientos desde el celular: pesos y repeticiones por ejercicio, rutinas propias y progreso a lo largo del tiempo. Sin backend: todo se guarda en el `localStorage` del navegador. Es instalable como PWA (funciona offline y se puede agregar a la pantalla de inicio).

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

1. Hacé push de este repo a GitHub (rama `claude/gym-progress-app-goyv40`, o ajustá el workflow).
2. En Settings → Pages, elegí "Deploy from a branch" y la rama/carpeta raíz (o usá el workflow ya incluido en `.github/workflows/pages-gym.yml`).
3. Usá la URL que te da GitHub Pages.

También funciona igual de bien en Netlify, Vercel o Cloudflare Pages arrastrando la carpeta.

## Funcionalidad

- **Rutinas**: creá rutinas con nombre y ejercicios (series y repeticiones objetivo), o editalas cuando quieras.
- **Importar de WhatsApp**: copiá el mensaje de texto con la rutina que te mandaron, pegalo en "Importar rutina de WhatsApp" y la app detecta automáticamente cada ejercicio con sus series y repeticiones (soporta formatos como `4x10`, `3 series x 12`, `4x8 40kg`, `3x fallo`). Después podés revisar y corregir cada línea antes de guardar — no requiere ninguna cuenta ni configuración adicional, es solo pegar y listo.
- **Registrar entrenamiento**: tocá el botón "+" para empezar, elegí una rutina (o "Entrenamiento libre") y cargá el peso y las repeticiones de cada serie a medida que entrenás. Se pueden agregar series de más o ejercicios extra que no estaban en la rutina original, sin tener que modificarla.
- **Progreso**: gráfico simple por ejercicio con el peso máximo levantado en cada sesión (o repeticiones, para ejercicios sin peso).
- **Historial**: todos los entrenamientos guardados, agrupados por día, con el detalle de cada serie.
- Configuración: unidad de peso (kg/lb) y exportar/borrar los datos.

## Sobre la importación de WhatsApp

Esta app no tiene backend ni se conecta a WhatsApp directamente (eso requeriría una cuenta de WhatsApp Business, credenciales de API y un servidor propio). En cambio, usa el flujo más simple y realista para un uso personal: copiás el texto del mensaje desde WhatsApp y lo pegás en la app, que lo interpreta automáticamente. Es prácticamente igual de rápido y no depende de servicios de terceros ni costos adicionales.

## Datos

Las rutinas y el historial de entrenamientos viven únicamente en el navegador (`localStorage`), por dispositivo. Para llevarlos a otro lado, usá "Exportar datos (JSON)" en Configuración.
