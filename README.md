- `brotli -d file.br -o file.tar`
  nx run be:build:models
  npx sequelize-cli db:migrate:undo
  npx sequelize-cli db:migrate
