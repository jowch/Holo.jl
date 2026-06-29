import tseslint from "typescript-eslint"

export default tseslint.config(
    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        extends: [...tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/no-explicit-any": "off", // manifest geometry is intentionally dynamic
            "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }], // allow _-prefixed intentional stubs
        },
    },
    { ignores: ["../assets/**", "node_modules/**"] },
)
