import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";

import {
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const handler = async (event) => {
  const tableName = process.env.EMAIL_LOGS_TABLE_NAME;
  const fromEmail = process.env.FROM_EMAIL;

  if (!tableName) {
    throw new Error("EMAIL_LOGS_TABLE_NAME is not configured");
  }

  if (!fromEmail) {
    throw new Error("FROM_EMAIL is not configured");
  }

  for (const record of event.Records || []) {
    let logId;

    try {
      // Get message from SQS
      const message = JSON.parse(record.body);

      logId = message.logId;

      const userEmail = message.userEmail;
      const selectedOption = message.selectedOption;
      const toEmail = message.toEmail;

      if (!logId || !userEmail || !selectedOption || !toEmail) {
        throw new Error("Invalid message data");
      }

      // Professional HTML email
      const htmlBody = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>New Form Submission</title>
          </head>

          <body style="
            margin: 0;
            padding: 0;
            background-color: #f4f6f8;
            font-family: Arial, Helvetica, sans-serif;
          ">

            <div style="
              max-width: 600px;
              margin: 40px auto;
              padding: 0 20px;
            ">

              <div style="
                background-color: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                border: 1px solid #e5e7eb;
              ">

                <!-- Header -->
                <div style="
                  background-color: #1f2937;
                  padding: 28px 30px;
                ">
                  <div style="
                    color: #ffffff;
                    font-size: 22px;
                    font-weight: 700;
                    margin-bottom: 6px;
                  ">
                    NexaCura Clinic
                  </div>

                  <div style="
                    color: #d1d5db;
                    font-size: 14px;
                  ">
                    New Form Submission
                  </div>
                </div>

                <!-- Content -->
                <div style="padding: 30px;">

                  <p style="
                    margin: 0 0 24px;
                    color: #374151;
                    font-size: 15px;
                    line-height: 1.6;
                  ">
                    A new early access form has been submitted.
                  </p>

                  <!-- Email -->
                  <div style="
                    background-color: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 18px;
                    margin-bottom: 14px;
                  ">
                    <div style="
                      color: #6b7280;
                      font-size: 12px;
                      font-weight: 600;
                      text-transform: uppercase;
                      letter-spacing: 0.5px;
                      margin-bottom: 7px;
                    ">
                      User Email
                    </div>

                    <div style="
                      color: #111827;
                      font-size: 16px;
                      font-weight: 600;
                      word-break: break-word;
                    ">
                      ${userEmail}
                    </div>
                  </div>

                  <!-- Selected Option -->
                  <div style="
                    background-color: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 18px;
                  ">
                    <div style="
                      color: #6b7280;
                      font-size: 12px;
                      font-weight: 600;
                      text-transform: uppercase;
                      letter-spacing: 0.5px;
                      margin-bottom: 7px;
                    ">
                      Interested As
                    </div>

                    <div style="
                      color: #111827;
                      font-size: 16px;
                      font-weight: 600;
                    ">
                      ${selectedOption}
                    </div>
                  </div>

                </div>

                <!-- Footer -->
                <div style="
                  border-top: 1px solid #e5e7eb;
                  padding: 18px 30px;
                  background-color: #fafafa;
                ">
                  <p style="
                    margin: 0;
                    color: #9ca3af;
                    font-size: 12px;
                    line-height: 1.5;
                  ">
                    This email was generated automatically from the
                    NexaCura Clinic early access form.
                  </p>
                </div>

              </div>

            </div>

          </body>
        </html>
      `;

      // Plain-text fallback
      const textBody = `
New Form Submission

NexaCura Clinic

User Email: ${userEmail}
Interested As: ${selectedOption}

This email was generated automatically from the NexaCura Clinic early access form.
`;

      // 1. Send email using SES
      const command = new SendEmailCommand({
        Source: fromEmail,

        Destination: {
          ToAddresses: [toEmail],
        },

        Message: {
          Subject: {
            Data: "New Form Submission | NexaCura Clinic",
            Charset: "UTF-8",
          },

          Body: {
            Html: {
              Data: htmlBody,
              Charset: "UTF-8",
            },

            Text: {
              Data: textBody,
              Charset: "UTF-8",
            },
          },
        },
      });

      await ses.send(command);

      // 2. Email successfully sent
      const sentAt = new Date().toISOString();

      await dynamodb.send(
        new UpdateItemCommand({
          TableName: tableName,

          Key: {
            id: { S: logId },
          },

          UpdateExpression:
            "SET #status = :status, sentAt = :sentAt",

          ExpressionAttributeNames: {
            "#status": "status",
          },

          ExpressionAttributeValues: {
            ":status": { S: "SUCCESS" },
            ":sentAt": { S: sentAt },
          },
        }),
      );

      console.log(`Email sent successfully. Log ID: ${logId}`);
    } catch (error) {
      console.error("Email worker error:", error);

      // Update DynamoDB as FAILED
      if (logId) {
        try {
          const failedAt = new Date().toISOString();

          await dynamodb.send(
            new UpdateItemCommand({
              TableName: tableName,

              Key: {
                id: { S: logId },
              },

              UpdateExpression:
                "SET #status = :status, failedAt = :failedAt",

              ExpressionAttributeNames: {
                "#status": "status",
              },

              ExpressionAttributeValues: {
                ":status": { S: "FAILED" },
                ":failedAt": { S: failedAt },
              },
            }),
          );
        } catch (updateError) {
          console.error(
            "Failed to update DynamoDB status:",
            updateError,
          );
        }
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      message: "Email worker processed successfully",
    }),
  };
};