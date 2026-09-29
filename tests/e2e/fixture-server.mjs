import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = `${resolve(fileURLToPath(new globalThis.URL('../fixtures/', import.meta.url)))}${sep}`;
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const secureHeaders = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; connect-src 'self' https://checkoutshopper-test.adyen.com https://checkoutanalytics-test.adyen.com; img-src 'self' https://checkoutshopper-test.cdn.adyen.com; frame-src https:; form-action 'self'; frame-ancestors 'self'; report-uri /csp-report",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
};
const cdnHeaders = {
  ...secureHeaders,
  'content-security-policy':
    "default-src 'self'; script-src 'self' https://checkoutshopper-test.cdn.adyen.com; style-src 'self' https://checkoutshopper-test.cdn.adyen.com; frame-src https:; frame-ancestors 'self'; report-to inspector",
  'reporting-endpoints': 'inspector="http://localhost:4321/csp-report"',
};
const apiResponses = new Map([
  [
    '/api/sessions',
    {
      id: 'dummy-session',
      sessionData: 'dummy',
      countryCode: 'NL',
      amount: { value: 1000, currency: 'EUR' },
    },
  ],
  ['/api/paymentMethods', { paymentMethods: [{ type: 'scheme', name: 'Card' }] }],
  ['/api/payments', { resultCode: 'Authorised' }],
  ['/api/payments/details', { resultCode: 'Authorised' }],
]);

createServer(async (request, response) => {
  try {
    const url = new globalThis.URL(request.url ?? '/', 'http://localhost:4321');
    const apiResponse = apiResponses.get(url.pathname);
    if (request.method === 'POST' && apiResponse !== undefined) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(apiResponse));
      return;
    }
    const file = resolve(root, decodeURIComponent(url.pathname.slice(1) || 'no-adyen.html'));
    const contentType = contentTypes[extname(file)];
    if (!file.startsWith(root) || contentType === undefined) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(file);
    let headers = {};
    if (url.pathname === '/dummy-merchant.html') {
      const scenario = url.searchParams.get('scenario');
      if (scenario === 'cdn-sri' || scenario === 'cdn-no-sri') {
        headers = cdnHeaders;
      } else if (['secure-headers', 'csp-resources'].includes(scenario)) {
        headers = secureHeaders;
      }
    }
    response.writeHead(200, { 'content-type': contentType, ...headers });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4321, 'localhost');
