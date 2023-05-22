const express = require('express')
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { Infobip, AuthType } =  require('@infobip-api/sdk');
const { Configuration, OpenAIApi } = require('openai');
dotenv.config();

const cloudinary = require('cloudinary');

const app = express()

const jsonParser = bodyParser.json()

app.post('/inbound', jsonParser, async (req, res) => {
  const infobip = new Infobip({
    baseUrl: process.env.INFOBIP_BASE_URL,
    apiKey: process.env.INFOBIP_API_KEY,
    authType: AuthType.ApiKey,
  });
  const configuration = new Configuration({
      // organization: process.env.OPENAI_ORG_ID,
      apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);
  const { results } = req.body;
  res.send(Promise.all(results.map(async (value) => {
    try {
      await infobip.channels.whatsapp.markAsRead(value.to, value.messageId);
      const content = value.message.text;
      if(content.length > 1000) {
        return await infobip.channels.whatsapp.send({
          type: 'text',
          from: value.to,
          to: value.from,
          content: {
            text: 'The phrase is too long',
          },
        });
      }
      const publicId = 'whatsapp_dalle/'+content.toLowerCase().replaceAll(/[^A-Za-z0-9]+/ig, '_');
      const searchResult = await cloudinary.v2.search
        .expression(`public_id:${publicId}`)
        .sort_by('public_id','desc')
        .max_results(1)
        .execute();
      if(searchResult.total_count<1) {
        const response = await openai.createImage({
          prompt: content,
          n: 1,
          size: "512x512",
        });
        image_url = response.data.data[0].url;
        await cloudinary.v2.uploader.upload(image_url, {
          resource_type: "image", 
          public_id: publicId,
        })
      }
      imageUrl = await cloudinary.v2.url(publicId)
      return await infobip.channels.whatsapp.send({
        type: 'image',
        from: value.to,
        to: value.from,
        content: {
          mediaUrl: imageUrl,
        },
      });
    } catch (error) {
      console.error(error)
      return error
    }
  })))
})

const port = process.env.PORT || 3000;
app.listen(port, '127.0.0.1', () => console.log(`WhatsApp to Dall-e app listening on port ${port}!`))