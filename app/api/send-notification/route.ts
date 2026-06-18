import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { to, subject, html } = body;

    const result = await resend.emails.send({
      from: "onboarding@icconinc.ca",
      to,
      subject,
      html,
    });

    return Response.json(result);
  } catch (error: any) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
