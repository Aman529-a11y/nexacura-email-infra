import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const handler = async (event: any) => {
  try {
    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body;

    const userEmail = body?.email;
    const selectedOption = body?.role;

    if (!userEmail || !selectedOption) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: "Email and selected option are required",
        }),
      };
    }

    const fromEmail = process.env.FROM_EMAIL;
    const toEmail = process.env.TO_EMAIL;

    if (!fromEmail || !toEmail) {
      throw new Error("FROM_EMAIL or TO_EMAIL is not configured");
    }

    const command = new SendEmailCommand({
      Source: fromEmail,
      Destination: {
        ToAddresses: [toEmail],
      },
      Message: {
        Subject: {
          Data: "New Form Submission",
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: `New form submission

User Email: ${userEmail}
Selected Option: ${selectedOption}
`,
            Charset: "UTF-8",
          },
        },
      },
    });

    await ses.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Email sent successfully",
      }),
    };
  } catch (error) {
    console.error("Email error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: "Failed to send email",
      }),
    };
  }
};