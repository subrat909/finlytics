/**
 * Tailwind v4 through PostCSS (Next.js). There is no tailwind.config: the theme is CSS in @finlytics/ui
 * (`@finlytics/ui/globals.css`), which src/app/globals.css imports.
 */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
