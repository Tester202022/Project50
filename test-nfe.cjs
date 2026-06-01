const axios = require('axios');

const GESTAOCLICK_ACCESS_TOKEN = "d1eae29cfe92a57083a0da755ca2b66395edbf4a";
const GESTAOCLICK_SECRET_ACCESS_TOKEN = "7cead000cb28a81dd5c8aa9cfafce61c3c682cbf";
const GESTAOCLICK_API_URL = "https://api.gestaoclick.com";

async function testPdfPaths() {
  const testId = "75960417";
  const paths = [
    `/notas_fiscais_produtos/${testId}/pdf`,
    `/notas_fiscais_produtos/${testId}/danfe`,
    `/notas_fiscais_produtos/pdf/${testId}`,
    `/notas_fiscais_produtos/danfe/${testId}`,
    `/notas_fiscais_produtos/${testId}/xml`,
  ];

  for (const path of paths) {
    try {
      const response = await axios({
        method: 'GET',
        url: `${GESTAOCLICK_API_URL}${path}`,
        headers: {
          'access-token': GESTAOCLICK_ACCESS_TOKEN,
          'secret-access-token': GESTAOCLICK_SECRET_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      console.log(`Path ${path} SUCCESS (status ${response.status}):`, Object.keys(response.data));
    } catch (error) {
      console.log(`Path ${path} FAILED (status ${error.response ? error.response.status : 'no response'}):`, error.response ? error.response.data : error.message);
    }
  }
}

testPdfPaths();
