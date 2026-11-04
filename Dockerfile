# Online Pallanguzhi: the Go server plus the built React page.
#   docker build -t pallanguzhi .
#   docker run --rm -p 127.0.0.1:10000:10000 pallanguzhi    # http://127.0.0.1:10000
FROM golang:1.26-alpine AS go
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY GOTOOLCHAIN=local
WORKDIR /src
COPY go.mod go.sum ./
# GOPROXY=direct (for networks without proxy.golang.org) fetches with git.
RUN if [ "$GOPROXY" = direct ]; then apk add --no-cache git >/dev/null; fi && go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o /out/app.wasm ./cmd/web \
 && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY web/ ./
COPY --from=go /out/app.wasm /out/wasm_exec.js public/
RUN npx tsc --noEmit && npx vite build --outDir /out/dist --logLevel warn

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /out/server /app/server
COPY --from=web /out/dist /app/dist
# Inside the container the server must accept the platform's router; what is
# reachable from outside is decided by the published port or the platform.
ENV ADDR=0.0.0.0:10000 STATIC_DIR=/app/dist
EXPOSE 10000
USER nonroot
ENTRYPOINT ["/app/server"]
