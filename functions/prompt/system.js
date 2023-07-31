export const systemText = (system,userName, prompt, currentTime) => {
    let result = system;
      result = result.replace(/\${userName}/g, userName);
      result = result.replace(/\${currentTime}/g, currentTime);
    
      return result;
    };