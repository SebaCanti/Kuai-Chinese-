# 快 Kuai Chinese

PWA para aprender chino de forma rápida.

## Cómo usarla

### En el celular (recomendado)

1. Abre el archivo `index.html` en el navegador de tu teléfono (Chrome, Safari, Edge…).
   - Lo más fácil: sube la carpeta a un hosting gratuito (Netlify, GitHub Pages, Vercel) o usa un servidor local.
2. **Instalar como app**:
   - **Android (Chrome)**: menú ⋮ → “Instalar aplicación” o “Añadir a la pantalla de inicio”.
   - **iPhone (Safari)**: botón Compartir → “Añadir a pantalla de inicio”.
3. Una vez instalada funciona como una app nativa (pantalla completa, icono propio).

### Uso diario

1. Copia cualquier frase (en chino, inglés o español).
2. En la app **mantén presionado** el cuadro grande → se pega automáticamente y se traduce.
3. También puedes pegar manualmente o escribir y pulsar “Traducir ahora”.

### Qué hace según el idioma

| Texto pegado | Resultado |
|--------------|-----------|
| **Chino** | Pinyin completo + traducción al inglés + tabla palabra por palabra (Pinyin + inglés). Botón para ver también en español. |
| **Inglés o Español** | Traducción completa al chino + Pinyin + tabla palabra por palabra. |

- Los compuestos chinos (ej. 北京大学) se intentan mantener juntos.
- Puedes guardar palabras individuales o todas en tu **diccionario personal**.
- Cada frase queda en el **historial** para revisarla después.

## Archivos

```
kuai-chinese/
├── index.html      ← abre este
├── styles.css
├── app.js
├── manifest.json   ← hace que sea instalable
├── sw.js           ← funciona offline (app shell)
├── icon-192.png
├── icon-512.png
└── README.md
```

## Notas técnicas

- Traducciones: endpoint gratuito de Google Translate (sin API key).
- Pinyin y segmentación: librería `pinyin-pro`.
- Datos (historial y diccionario) se guardan solo en tu dispositivo (`localStorage`).
- Necesita HTTPS (o localhost) para poder leer el portapapeles.

## Servidor local rápido

```bash
cd kuai-chinese
npx serve .
# o
python3 -m http.server 8080
```

Luego abre `http://localhost:8080` en el navegador del celular (misma red Wi-Fi).
