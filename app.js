const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('./request');
const packageJSON = require('NeteaseCloudMusicApi/package.json');
const exec = require('child_process').exec;
const cache = require('NeteaseCloudMusicApi/util/apicache').middleware;
const { cookieToJson } = require('NeteaseCloudMusicApi/util/index');
const fileUpload = require('express-fileupload');
// version check
promisify(exec)('npm info NeteaseCloudMusicApi version').then(({ stdout }) => {
  let version = stdout.trim();
  if (packageJSON.version >= version) return;
  console.log(`最新版本: ${version}, 当前版本: ${packageJSON.version}, 请及时更新`);
});

const app = express();

// CORS & Preflight request
app.use((req, res, next) => {
  if (req.path !== '/' && !req.path.includes('.')) {
    res.set({
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type',
      'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    })
  }
  req.method === 'OPTIONS' ? res.status(204).end() : next()
})

// cookie parser
app.use((req, res, next) => {
  req.cookies = (req.headers.cookie || '')
    .split(/\s*;\s*/).reduce((o, pair) =>
      (pair = decodeURIComponent(pair).split('='), pair.length === 2 && (o[pair[0].trim()] = pair[1].trim()), o),
      Object.create(null));
  next();
});

// body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(fileUpload());

// static
app.use(express.static(path.join(__dirname, 'public')));

// cache
app.use(cache('2 minutes', (req, res) => res.statusCode === 200));
// router
const special = {
  'daily_signin.js': '/daily_signin',
  'fm_trash.js': '/fm_trash',
  'personal_fm.js': '/personal_fm',
}
// require('./node_modules/NeteaseCloudMusicApi/module/')
// require.context('NeteaseCloudMusicApi/module/', false, /\.js$/);
const MODULE_PATH = path.join(__dirname, 'node_modules/NeteaseCloudMusicApi/module/');

(async () => {
  const files = await promisify(fs.readdir)(MODULE_PATH);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.js')) continue;
    const route = file in special ? special[file] : '/' + file.replace(/\.js$/i, '').replace(/_/g, '/');
    const question = require(path.join(MODULE_PATH, file));
    app.use(route, async (req, res) => {
      [req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') {
          item.cookie = cookieToJson(decodeURIComponent(item.cookie))
        }
      });
      const query = { cookie: req.cookies, ...req.query, ...req.body, ...req.files }
      try {
        const answer = await question(query, request);
        console.log('[OK]', decodeURIComponent(req.originalUrl));
        res.append('Set-Cookie', answer.cookie);
        res.status(answer.status).send(answer.body);
      } catch (error) {
        console.log('[ERR]', decodeURIComponent(req.originalUrl), {
          status: error.status,
          body: error.body,
        });
        if (error.body.code == '301') error.body.msg = '需要登录';
        res.append('Set-Cookie', error.cookie);
        res.status(error.status).send(error.body);
      }
    });
  }

  const { PORT: port = 3000, HOST: host = '' } = process.env;
  app.server = app.listen(port, host, () => {
    console.log(`server running @ http://${host ? host : 'localhost'}:${port}`)
  });
})();
