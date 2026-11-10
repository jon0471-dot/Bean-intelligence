const h = await Bun.file(process.argv[2]).json()
console.log(JSON.stringify({ time: h.time, chat: h.gateway.breaker.classes.find((c: any) => c.class === 'chat'), functions: h.gateway.breaker.classes.find((c: any) => c.class === 'functions') }, null, 1))
