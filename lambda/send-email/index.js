import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

import {
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";

import { randomUUID } from "node:crypto";

const sqs = new SQSClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
};

export const handler = async (event) => {
  let logId;
  let tableName;

  try {
    // Handle CORS preflight request
    const requestMethod =
      event?.httpMethod ||
      event?.requestContext?.http?.method;

    if (requestMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body;

    const userEmail = body?.email;
    const selectedOption = body?.role;

    // Validate request
    if (!userEmail || !selectedOption) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: "Email and selected option are required",
        }),
      };
    }

    const toEmail = process.env.TO_EMAIL;
    tableName = process.env.EMAIL_LOGS_TABLE_NAME;
    const queueUrl = process.env.EMAIL_QUEUE_URL;

    if (!toEmail) {
      throw new Error("TO_EMAIL is not configured");
    }

    if (!tableName) {
      throw new Error("EMAIL_LOGS_TABLE_NAME is not configured");
    }

    if (!queueUrl) {
      throw new Error("EMAIL_QUEUE_URL is not configured");
    }

    // Generate unique log ID
    logId = randomUUID();

    const createdAt = new Date().toISOString();

    // 1. Save form submission in DynamoDB as PENDING
    await dynamodb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          id: { S: logId },
          userEmail: { S: userEmail },
          selectedOption: { S: selectedOption },
          status: { S: "PENDING" },
          createdAt: { S: createdAt },
        },
      }),
    );

    try {
      // 2. Put email job into SQS queue
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            logId,
            userEmail,
            selectedOption,
            toEmail,
          }),
        }),
      );

      // Email job successfully queued
      return {
        statusCode: 202,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: "Email queued successfully",
          logId,
        }),
      };
    } catch (queueError) {
      console.error("Queue error:", queueError);

      // Queue failed, update DynamoDB status to FAILED
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

      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: "Failed to queue email",
          logId,
        }),
      };
    }
  } catch (error) {
    console.error("Lambda error:", error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        message: "Internal server error",
      }),
    };
  }
};