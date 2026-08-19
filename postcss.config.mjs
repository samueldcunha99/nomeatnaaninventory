/** Tailwind v4 is a PostCSS plugin; there is no tailwind.config.js — the theme lives in
 *  app/globals.css under @theme. See AGENTS.md § Design tokens. */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
