FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Integridade do contexto de build. Sem estes ficheiros a imagem sobe
# "saudável" mas o bot/dashboard falham em runtime com ENOENT/MODULE_NOT_FOUND.
RUN node -e "const fs=require('fs');const need=['src/index.js','src/bot.js','src/dashboard.js','src/dashboard/routes/index.js','public/index.html','public/js/dashboard.js','public/css/dashboard.css','public/locales/pt.js'];const miss=need.filter((p)=>!fs.existsSync(p));console.log('src/ ficheiros:',fs.existsSync('src')?fs.readdirSync('src').length:'AUSENTE','| public/:',fs.existsSync('public')?fs.readdirSync('public').length:'AUSENTE');if(miss.length){console.error('ERRO: faltam ficheiros no contexto de build:');for(const m of miss){console.error('  - '+m);}process.exit(1);}console.log('OK: integridade do contexto de build verificada');"

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["npm", "start"]
