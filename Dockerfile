# 中转服务镜像：零 npm 依赖，只靠 Node 自带的 node:sqlite。
# 目录结构必须保持 publish-api 与 board-web 平级，static.js 用 ../board-web 发渲染层。
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
# 容器里必须监听 0.0.0.0，否则平台的健康检查连不上
ENV HOST=0.0.0.0
# 数据落在挂载的持久卷上；没有卷时也能起来（数据随容器消失）
ENV DB_PATH=/data/publish.db

COPY board-web ./board-web
COPY publish-api ./publish-api

WORKDIR /app/publish-api
# 平台会注入 PORT；本地未注入时 config.js 默认 8787
EXPOSE 8080

CMD ["node", "main.js"]
