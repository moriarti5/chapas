# Liga Manager

App para gestionar equipos de fútbol, jugadores, competiciones (ligas y torneos con liguilla + playoff), calendario, clasificación, goleadores y porteros. Los datos se guardan en el navegador (`localStorage`), por lo que son locales a cada dispositivo/navegador donde se use.

## Probar en local

```bash
npm install
npm run dev
```

Abre la URL que muestre la terminal (normalmente http://localhost:5173).

## Subir a GitHub y publicar como web (GitHub Pages)

1. Crea un repositorio en GitHub y sube este proyecto:
   ```bash
   git init
   git add .
   git commit -m "Liga Manager"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
2. Instala la herramienta de despliegue:
   ```bash
   npm install -D gh-pages
   ```
3. Añade estos scripts a `package.json` (dentro de `"scripts"`):
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d dist"
   ```
4. Publica:
   ```bash
   npm run deploy
   ```
5. En GitHub, ve a **Settings → Pages** y confirma que la rama `gh-pages` está seleccionada como origen. Tu web quedará en `https://TU_USUARIO.github.io/TU_REPO/`.

### Alternativas más simples
Si prefieres no usar GitHub Pages, puedes conectar el repositorio directamente a **Vercel** o **Netlify** (ambos gratuitos): al importar el repo detectan Vite automáticamente y solo hay que darle a "Deploy".

## Instalar como app en el móvil

La app es una PWA (Progressive Web App) instalable:

- **Android (Chrome)**: abre la web publicada → menú (⋮) → "Añadir a pantalla de inicio" o "Instalar app".
- **iPhone (Safari)**: abre la web → botón compartir (□↑) → "Añadir a pantalla de inicio".

Quedará con su propio icono y se abrirá en pantalla completa, como una app nativa.

## Notas

- Los datos se guardan solo en el navegador de cada dispositivo. Si necesitas que varias personas compartan los mismos datos desde distintos dispositivos, habría que añadir una base de datos en la nube (puedo ayudarte con eso si lo necesitas más adelante).
- Los iconos (`public/icon-192.png`, `public/icon-512.png`) son un placeholder sencillo; puedes sustituirlos por tu propio logo manteniendo el mismo nombre de archivo y tamaño.
