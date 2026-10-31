let input = ''
for await (const chunk of process.stdin) input += chunk
const request = JSON.parse(input)
if (request.operation === 'reconcile') process.stdout.write(JSON.stringify({ state: 'sent', receiptRef: 'fixture:sent' }))
else if (request.operation === 'send') process.stdout.write(JSON.stringify({ accepted: true }))
else process.exitCode = 2
