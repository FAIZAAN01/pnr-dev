require('dotenv').config();
const { createClient } = require('@vercel/kv');

async function clearBrands() {
  const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  console.log("Attempting to delete the 'pnr-brands' key...");
  const result = await kv.del('pnr-brands');
  
  if (result > 0) {
    console.log("Success! The 'pnr-brands' key and all its data have been deleted.");
  } else {
    console.log("The 'pnr-brands' key did not exist, so nothing was deleted. Your database is clean.");
  }
}

clearBrands();