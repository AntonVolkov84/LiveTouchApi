import { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise';

const client = new RecaptchaEnterpriseServiceClient({
  keyFilename: './recaptcha-service-account.json', 
});

export const verifyCaptcha = async (token, projectId) => {
      const request = {
    parent: `projects/${projectId}`,
    assessment: {
      event: {
        token,
        siteKey: process.env.RECAPTCHA_SITE_KEY_ANDROID, 
        expectedAction: 'register', 
      },
    },
  };

  try {
    const [response] = await client.createAssessment(request);
    console.log(response)
    const isValid = response.tokenProperties?.valid;
    return { success: isValid, response };
  } catch (err) {
    console.error('Enterprise reCAPTCHA error:', err);
    return { success: false, error: err };
  }
};
