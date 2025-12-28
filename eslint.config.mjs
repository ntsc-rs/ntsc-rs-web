// @ts-check
import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            '**/public/**/*.{cjs,mjs,js,ts,jsx,tsx}',
            '**/ntsc-rs-web-wrapper/**/*',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            parserOptions: {
                project: 'tsconfig.json',
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', {
                args: 'after-used',
                varsIgnorePattern: '__.*$',
            }],

            'no-constant-condition': ['error', {
                checkLoops: false,
            }],

            '@stylistic/array-bracket-spacing': ['error', 'never'],
            '@stylistic/block-spacing': ['error', 'never'],

            camelcase: ['error', {
                properties: 'never',
            }],

            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/comma-spacing': ['error'],
            '@stylistic/comma-style': ['error'],
            '@stylistic/eol-last': ['error', 'always'],
            eqeqeq: ['warn'],
            '@stylistic/function-call-spacing': ['error', 'never'],

            '@stylistic/indent': ['error', 4, {
                SwitchCase: 1,
            }],

            '@stylistic/key-spacing': ['error', {
                beforeColon: false,
                afterColon: true,
                mode: 'strict',
            }],

            '@stylistic/keyword-spacing': ['error', {
                before: true,
                after: true,
            }],

            '@stylistic/max-len': [1, {
                code: 120,
                tabWidth: 4,
                ignoreUrls: true,
                ignoreTemplateLiterals: true,
            }],

            '@stylistic/new-parens': ['error'],
            '@stylistic/newline-per-chained-call': ['error'],
            'no-console': ['error'],
            'no-mixed-operators': ['error'],

            'no-multiple-empty-lines': ['error', {
                max: 2,
                maxBOF: 0,
                maxEOF: 0,
            }],

            'no-throw-literal': ['error'],

            '@stylistic/no-trailing-spaces': ['error', {
                skipBlankLines: true,
            }],

            'no-unneeded-ternary': ['error'],
            '@stylistic/object-curly-spacing': ['error'],

            '@stylistic/object-property-newline': ['error', {
                allowAllPropertiesOnSameLine: true,
            }],

            '@stylistic/operator-linebreak': ['error', 'after', {
                overrides: {
                    '|': 'ignore',
                },
            }],
            'prefer-const': ['error'],

            '@stylistic/quotes': ['error', 'single', {
                allowTemplateLiterals: 'always',
                avoidEscape: true,
            }],

            '@stylistic/semi': ['error', 'always'],
            '@stylistic/semi-spacing': ['error'],
            '@stylistic/space-before-function-paren': ['error', {
                anonymous: 'never',
                named: 'never',
                asyncArrow: 'never',
                catch: 'always',
            }],
            '@stylistic/space-in-parens': ['error'],
            '@stylistic/space-infix-ops': ['error'],
            '@stylistic/space-unary-ops': ['error'],

            '@typescript-eslint/no-misused-promises': ['error', {
                checksVoidReturn: false,
            }],
        },
    },
    {
        files: ['**/*.{js,mjs,cjs,jsx}'],
        ...tseslint.configs.disableTypeChecked,
    },
    {
        files: ['**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs',
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
);
