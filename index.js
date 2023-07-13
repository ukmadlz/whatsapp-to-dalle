const express = require('express')
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const pg = require('pg');
const path = require('path');
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
      const sendCoupon = async (value, coupon, coupon_value) => {
        await infobip.channels.whatsapp.send({
          type: 'text',
          from: value.to,
          to: value.from,
          content: {
            text: `You can apply your ${coupon_value} coupon at https://portal.infobip.com/referrals and your code is:`,
          },
        });
        await infobip.channels.whatsapp.send({
          type: 'text',
          from: value.to,
          to: value.from,
          content: {
            text: coupon,
          },
        });
      }
      await infobip.channels.whatsapp.markAsRead(value.to, value.messageId);
      const content = value.message.text;
      if(process.env.DATABASE_URL && (
        content == "Hey Infobip! I’d like $100 of Infobip credits, please"
        || content.toLowerCase() == "coupon please"
      )) {
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
          client.query("SELECT id, coupon, coupon_value FROM coupons_meetups WHERE cellphone = $1 ORDER BY id ASC LIMIT 1", [cellphone], (err, result) => {
            if (err) throw err;
      
            if(result.rows.length < 1) {
              client.query("SELECT id, coupon, coupon_value FROM coupons_meetups WHERE cellphone IS NULL ORDER BY id ASC LIMIT 1", [], (err, result) => {
                if (err) throw err;
                
                if(result.rows.length < 1) {
                  infobip.channels.whatsapp.send({
                    type: 'text',
                    from: value.to,
                    to: value.from,
                    content: {
                      text: `We have run out of coupons, please chat to someone from the Infobip Developer Relations team`,
                    },
                  });
                  client.end((err) => {
                    if (err) throw err;
                  });
                } else {
                  const row = result.rows[0];
                  client.query("UPDATE coupons_meetups SET cellphone = $1 WHERE id = $2", [cellphone, row.id], (err, result) => {
                    sendCoupon (value, row.coupon, row.coupon_value);
                    client.end((err) => {
                      if (err) throw err;
                    });
                  });
                }
              });
            } else {
              const row = result.rows[0];
              sendCoupon (value, row.coupon, row.coupon_value);
              client.end((err) => {
                if (err) throw err;
              });
            }
          });
        });
      } else if (content.toLowerCase() == 'discord') {
        await infobip.channels.whatsapp.send({
          type: 'text',
          from: value.to,
          to: value.from,
          content: {
            text: `You can join the Infobip Discord at https://discord.com/invite/G9Gr6fk2e4`,
          },
        });
      } else if (content.toLowerCase() == 'infobip') {
        await infobip.channels.whatsapp.send({
          type: 'text',
          from: value.to,
          to: value.from,
          content: {
            text: `You can get more information about Infobip at https://www.infobip.com/developers/`,
          },
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
        const publicId = 'whatsapp_dalle/'
          +((new Date()).toISOString().split('T')[0])
          +'/'
          +content.toLowerCase().replaceAll(/[^A-Za-z0-9]+/ig, '_');
        // Check if the image already exists
        const searchResult = await cloudinary.v2.search
          .expression(`public_id:${publicId}`)
          .sort_by('public_id','desc')
          .max_results(1)
          .execute();
        // If it doesn't, get the image and store
        if(searchResult.total_count<1) {
          // Generate image
          try {
            const response = await openai.createImage({
              prompt: content,
              n: 1,
              size: "512x512",
            });
            image_url = response.data.data[0].url;
          } catch (err) {
            console.error(err);
            const response = await openai.createImage({
              prompt: 'random rick astley',
              n: 1,
              size: "512x512",
            });
            image_url = response.data.data[0].url;
          }
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
});
app.use('/', express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WhatsApp to Dall-e app listening on port ${port}!`))