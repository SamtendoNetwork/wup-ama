// Pretty imports :3
const postgres = require('postgres').default || require('postgres');
const { rateLimit } = require('express-rate-limit');
const xmlbuilder = require('xmlbuilder');
const express = require('express');
require('dotenv').config();
const app = express();
require('colors');

// NOTE: this is an expantion of Jon Barrow's implementation of wup-ama.app.nintendo.net https://github.com/jonbarrow/csms

// Gives the actual ip of the requester if it's behind cloudflare proxy and such, comment it if it's not needed
app.set('trust proxy', 1);

// General limiter for every route
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minute window
    limit: 120,                 // 120 requests per IP per window
    legacyHeaders: false,
    message: 'Too many requests, please try again later.'
});

// Stricter limiter for the pickup endpoint, since it runs ORDER BY RANDOM()
const pickupLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    legacyHeaders: false,
    // Just makes the game return service unavailable
    message: ''
});

app.use(globalLimiter);
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

if (!process?.env?.SN_SMM_DOTHUB_POSTGRES_URI) {
    console.error('Postgresql URI missing. Please add it to the enviroment file as SN_SMM_POSTGRES_URI.')
    return;
}
const sql = postgres(process.env.SN_SMM_DOTHUB_POSTGRES_URI);


// getCourses grabs random courses to give back to pickup
async function getCourses(limit) {

  const query = `
  		SELECT
			object.data_id
		FROM datastore.objects object
		JOIN datastore.object_custom_rankings ranking
		ON
			object.data_id = ranking.data_id AND
			object.upload_completed = TRUE AND
			object.deleted = FALSE AND
			object.under_review = FALSE AND
			ranking.application_id = 0
		ORDER BY RANDOM()
		LIMIT $1
  `;

  const courses = await sql.unsafe(query, [limit]);
  return courses;
}

app.get('/api/v1/pickup/:difficulty', pickupLimiter, async (request, response) => {
    let valid = ['easy', 'normal', 'expert', 'super_expert'], // valid difficulty types
        difficulty = request.params.difficulty,
        difficulty_index;
	console.log('Request for pickup')
    if (!valid.includes(difficulty)) {
        return response.sendStatus(404); // if the requested difficulty isn't valid, send a 404
    }

    response.set('Content-Type', 'application/xml');

    // Do we still need this? I'm not sure if our super mario maker server tracks difficulty as of right now
    switch (difficulty) {
        case 'easy':
            difficulty_index = 0;
            break;
        case 'normal':
            difficulty_index = 1;
            break;
        case 'expert':
            difficulty_index = 2;
            break;
        case 'super_expert':
            difficulty_index = 3;
            break;
    }

    // create base JSON object.
    // SMM expects an XML response, but working in XML is a pain.
    // So instead we work in JSON and convert to XML later
    let json = {
        root: {
            courses: []
        }
    }

    let courses;
    courses = await getCourses(400);
    for (let course of courses) {
        json.root.courses.push({
            course: {
                id: course.data_id
            }
        });
    }
	const response_to_send = xmlbuilder.create(json).end({ pretty: true });
	console.log('Response: ', response_to_send)
    response.send(response_to_send);
});

const port = process?.env?.SN_SMM_DOTHUB_PORT || 8080;
app.listen(port, () => {
    console.log('Server'.blue + ' started '.green.bold + 'on port '.blue + new String(port).yellow);
});
