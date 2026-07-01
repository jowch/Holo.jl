import tseslint from "typescript-eslint"

export default tseslint.config(
    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        extends: [...tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/no-explicit-any": "off", // WGLMakie interop + the dynamic scene payload are intentionally untyped
            "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        },
    },
    { ignores: ["../assets/**", "node_modules/**"] },
)
