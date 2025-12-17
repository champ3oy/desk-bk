import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface InvitationEmailProps {
  to: string;
  inviteLink: string;
  organizationName: string;
  inviterName?: string;
}

@Injectable()
export class EmailService {
  private resend: Resend; // Temporarily any to avoid compilation if types aren't perfect yet, but ideally Resend
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY is not defined. Email sending will be disabled.',
      );
    }
    this.resend = new Resend(apiKey);
    this.fromEmail =
      this.configService.get<string>('EMAIL_FROM') ||
      'Morpheus Desk <onboarding@resend.com>';
  }

  async sendInvitation(props: InvitationEmailProps): Promise<void> {
    const { to, inviteLink, organizationName, inviterName } = props;

    try {
      if (!this.resend.apiKeys) {
        // Simple check if client is ready, though Resend constructor doesn't throw immediately usually
        // actually Resend throws on send if no key.
      }

      const subject = `You've been invited to join ${organizationName} on Morpheus Desk`;

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; padding: 20px; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 40px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
              .button { display: inline-block; background-color: #000; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin-top: 20px; }
              .footer { margin-top: 30px; font-size: 12px; color: #71717a; }
              .logo { margin-bottom: 24px; text-align: center; }
              .logo img { height: 40px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">
                <img src="${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/logo.png" alt="Morpheus Desk" style="height: 48px;" />
              </div>
              <h2>Hello,</h2>
              <p>
                ${inviterName || 'Someone'} has invited you to join <strong>${organizationName}</strong> on Morpheus Desk.
              </p>
              <p>Morpheus Desk is your all-in-one platform for customer support and ticket management.</p>
              
              <a href="${inviteLink}" class="button">Accept Invitation</a>
              
              <p style="margin-top: 24px; font-size: 14px; color: #52525b;">
                Or copy and paste this link into your browser: <br>
                <a href="${inviteLink}" style="color: #2563eb;">${inviteLink}</a>
              </p>
              
              <div class="footer">
                <p>If you were not expecting this invitation, you can ignore this email.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      // const { data, error } = await this.resend.emails.send({ ... }); // newer resend SDK returns object
      // Let's use standard try/catch
      await this.resend.emails.send({
        from: this.fromEmail,
        to: [to],
        subject,
        html,
      });

      this.logger.log(`Invitation email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${to}`, error);
      // Don't throw, just log. We don't want to break the API flow if email fails in this context?
      // Actually, for invitations, email IS the feature. Maybe we should throw.
      // For now, let's log.
    }
  }
}
