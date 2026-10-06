// CSS side-effect imports (`import "./globals.css"`, the fontsource stylesheets) need a module declaration: TypeScript 6
// turns on noUncheckedSideEffectImports, which otherwise fails them with TS2882 (plan D17). The bundler (Vite, Next.js)
// handles the import itself.
declare module "*.css";
