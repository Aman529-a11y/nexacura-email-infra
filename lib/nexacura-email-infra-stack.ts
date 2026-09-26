import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";

export class NexacuraEmailInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const emailLambda = new lambda.Function(this, "EmailLambda", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/send-email"),

      environment: {
        FROM_EMAIL: process.env.FROM_EMAIL || "",
        TO_EMAIL: process.env.TO_EMAIL || "",
      },
    });

    // Permission for Lambda to send email using AWS SES
    emailLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    const api = new apigateway.RestApi(this, "EmailApi");

    const email = api.root.addResource("send-email");

    email.addMethod(
      "POST",
      new apigateway.LambdaIntegration(emailLambda),
    );
  }
}