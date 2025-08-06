## Getting Started

### Run development:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Run production:

- Start

```bash
git clone https://github.com/Rudchyk/childbex.git
cd childbex
mv .env.example .env
nano .env
#If not allow indexing
cp assets/robots.txt public/robots.txt
npm run build
```

- Запуск тільки childbex.com

```
pm2 start ecosystem.config.js --only childbex.com
```

- Запуск тільки dev.childbex.com

```
pm2 start ecosystem.config.js --only dev.childbex.com
```

### Check links

- [robots.txt](http://localhost:3000/robots.txt)
- [health](http://localhost:3000/health)
- [uploads Logo.svg](http://localhost:3000/uploads/Logo.svg)
