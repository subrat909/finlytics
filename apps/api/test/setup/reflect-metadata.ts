/**
 * Loads the Reflect metadata polyfill before any test module, as src/main.ts does before Nest: decorators that Oxc
 * emits call Reflect.metadata(), and Nest reads it back.
 */
import "reflect-metadata";
