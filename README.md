# Ricardo Sacco – O Bombado Afetado (Protótipo)

Protótipo em **React + Canvas** (Vite + TypeScript).

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse o endereço que o Vite indicar (tipicamente http://localhost:5173).

## Build de produção

```bash
npm run build
npm run preview
```

## Controles

- **← →** mover
- **↑** pular
- **Espaço** carregar/soltar o **Megafone**
- **R** reinicia a fase

## Estrutura

- `src/App.tsx` – código principal do jogo (3 fases + chefe)
- `src/main.tsx` – ponto de entrada React
- `index.html` – HTML básico
- `vite.config.ts`, `tsconfig.json` – configs