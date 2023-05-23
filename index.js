const express = require('express')
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const fs = require('fs');
const pg = require('pg');
const url = require('url');
const { Infobip, AuthType } =  require('@infobip-api/sdk');
const { Configuration, OpenAIApi } = require('openai');
dotenv.config();

const cloudinary = require('cloudinary');

const app = express()

const jsonParser = bodyParser.json()

app.get('/', async (req, res) => {
  res.json({});
})
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
      if(content == "Hey Infobip! I’d like $100 of Infobip credits, please" ) {
        const connectionUrl = new URL(process.env.DATABASE_URL);
        connectionUrl.search = "";
        const pgConfig = {
            connectionString: connectionUrl.href,
            ssl: {
                rejectUnauthorized: true,
                ca: process.env.CA_PEM,
            },
        };
      
        const client = new pg.Client(pgConfig);
        client.connect((err) =>  {
          if (err) throw err;
          const cellphone = value.from;
          client.query("SELECT id, coupon FROM coupons WHERE cellphone = $1 ORDER BY id ASC LIMIT 1", [cellphone], (err, result) => {
            if (err) throw err;
      
            if(result.rows.length < 1) {
              client.query("SELECT id, coupon FROM coupons WHERE cellphone IS NULL ORDER BY id ASC LIMIT 1", [], (err, result) => {
                if (err) throw err;
                
                if(result.rows.length < 1) {
                  infobip.channels.whatsapp.send({
                    type: 'text',
                    from: value.to,
                    to: value.from,
                    content: {
                      text: `We have run out of coupons, please chat to someone at the booth`,
                    },
                  });
                  client.end((err) => {
                    if (err) throw err;
                  });
                } else {
                  const row = result.rows[0];
                  client.query("UPDATE coupons SET cellphone = $1 WHERE id = $2", [cellphone, row.id], (err, result) => {
                    infobip.channels.whatsapp.send({
                      type: 'text',
                      from: value.to,
                      to: value.from,
                      content: {
                        text: `Your coupon code is ${row.coupon}`,
                      },
                    });
                    client.end((err) => {
                      if (err) throw err;
                    });
                  });
                }
              });
            } else {
              const row = result.rows[0];
              infobip.channels.whatsapp.send({
                type: 'text',
                from: value.to,
                to: value.from,
                content: {
                  text: `Your coupon code is ${row.coupon}`,
                },
              });
              client.end((err) => {
                if (err) throw err;
              });
            }
          });
        });
      } else {
        // Dall-e doesn't accept prompts over 1000
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
        // Simplified Public ID for Cloudinary
        const publicId = 'whatsapp_dalle/'+content.toLowerCase().replaceAll(/[^A-Za-z0-9]+/ig, '_');
        // Check if the image already exists
        const searchResult = await cloudinary.v2.search
          .expression(`public_id:${publicId}`)
          .sort_by('public_id','desc')
          .max_results(1)
          .execute();
        // If it doesn't, get the image and store
        if(searchResult.total_count<1) {
          // Generate image
          const response = await openai.createImage({
            prompt: content,
            n: 1,
            size: "512x512",
          });
          image_url = response.data.data[0].url;
          // Upload to Cloudinary
          await cloudinary.v2.uploader.upload(image_url, {
            resource_type: "image", 
            public_id: publicId,
          })
        }
        // Get the Cloudinary URL
        imageUrl = await cloudinary.v2.url(publicId)
        // Send back to WhatsApp user
        return await infobip.channels.whatsapp.send({
          type: 'image',
          from: value.to,
          to: value.from,
          content: {
            mediaUrl: imageUrl,
          },
        });
      }
    } catch (error) {
      // Error collection… cus why not
      console.error(error)
      return error
    }
  })))
})

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WhatsApp to Dall-e app listening on port ${port}!`))