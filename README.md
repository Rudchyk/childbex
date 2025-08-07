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
- [API hello](https://dev.childbex.com/api/hello)

#### Helpers

```bash
git reset --hard HEAD
pm2 stop dev.childbex.com;
pm2 restart dev.childbex.com; pm2 logs dev.childbex.com;
nano /data/dev.childbex.com/.env
git pull; npm run build; pm2 restart dev.childbex.com; pm2 logs dev.childbex.com;
pm2 restart dev.childbex.com --update-env; pm2 logs dev.childbex.com;
pm2 restart childbex --update-env; pm2 logs childbex;
tail -n 1000 /root/.pm2/logs/dev.childbex.com-out.log
tail -n 1000 /root/.pm2/logs/dev.childbex.com-error.log
PORT=3001 NODE_ENV=development pm2 start npm --name dev.childbex2 -- run dev
```
