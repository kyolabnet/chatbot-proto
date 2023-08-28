export const systemText = (system,userName, prompt, currentTime) => {
    return system.replace(/\${userName}/g, userName).replace(/\${currentTime}/g, currentTime);
};