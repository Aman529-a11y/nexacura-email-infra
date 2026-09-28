import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

export class NexacuraEmailInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SQS Queue
    const emailQueue = new sqs.Queue(this, "EmailQueue", {
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    // DynamoDB Table
    const emailLogsTable = new dynamodb.Table(this, "EmailLogsTable", {
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // API Lambda
    // Form request receive karega,
    // DynamoDB me PENDING save karega,
    // aur SQS me message dalega.
    const emailLambda = new lambda.Function(this, "EmailLambda", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/send-email"),

      environment: {
        FROM_EMAIL: "praneetmaroo@nexacurahealthcare.com",
        TO_EMAIL: "shivendra.singh@nexacurahealthcare.com",
      },
    });

    // API Lambda -> DynamoDB permission
    emailLogsTable.grantReadWriteData(emailLambda);

    emailLambda.addEnvironment(
      "EMAIL_LOGS_TABLE_NAME",
      emailLogsTable.tableName,
    );

    // API Lambda -> SQS permission
    emailQueue.grantSendMessages(emailLambda);

    emailLambda.addEnvironment(
      "EMAIL_QUEUE_URL",
      emailQueue.queueUrl,
    );

    // Worker Lambda
    // SQS se message lega,
    // SES se email bhejega,
    // DynamoDB me SUCCESS / FAILED update karega.
    const processEmailLambda = new lambda.Function(
      this,
      "ProcessEmailLambda",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/process-email"),
        timeout: cdk.Duration.seconds(30),

        environment: {
          FROM_EMAIL: "praneetmaroo@nexacurahealthcare.com",
          EMAIL_LOGS_TABLE_NAME: emailLogsTable.tableName,
        },
      },
    );

    // Worker Lambda -> DynamoDB permission
    emailLogsTable.grantReadWriteData(processEmailLambda);

    // Worker Lambda -> SQS consume permission
    emailQueue.grantConsumeMessages(processEmailLambda);

    // Worker Lambda -> SES permission
    processEmailLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    // SQS -> Worker Lambda trigger
    processEmailLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(emailQueue, {
        batchSize: 1,
      }),
    );

    // API Gateway
    const api = new apigateway.RestApi(this, "EmailApi", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
      },
    });

    // POST /send-email
    const email = api.root.addResource("send-email");

    email.addMethod(
      "POST",
      new apigateway.LambdaIntegration(emailLambda),
    );
  }
}