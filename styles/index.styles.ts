import { StyleSheet } from "react-native";
 
 export const styles = StyleSheet.create({
    container: {
        flex:1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
    },
    titleContainer:{
        width: '90%',
        paddingHorizontal: 20,
        alignItems: 'flex-start',
    },
    brand:{
        fontSize:33,
    },
    lottie: {
        width:'100%',
        height:'60%',
    },
    textBold1: {
         fontSize: 52,        
         fontWeight: '900',  
  },
   textBold2: {
         fontSize: 52,        
         fontWeight: '900',    
         color: '#aa0cbe'
  },
    textSub:{
        fontSize:28,
        fontStyle: 'italic',
    },
    textAuthor:{
        fontSize:22,
        alignSelf:'flex-end',
    },
    buttonContainer:{
        marginVertical:15,
        flexDirection:'row',
        width:'100%',
        paddingHorizontal: 20,
    },
    buttonSignup:{
        flex:1,
        paddingVertical: 17,
        backgroundColor: '#000000',
        borderRadius: 80,
        justifyContent:'center',
        flexDirection:'row',
        marginHorizontal: 10,
        alignItems: 'center',
    },
    textSignup:{
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize:24,
        paddingLeft:10
    },
    //  buttonLogin:{
    //     flex:1,
    //     paddingVertical: 15,
    //     borderColor: '#000000',
    //     borderWidth: 2,
    //     backgroundColor:'transparent',
    //     borderRadius: 80,
    //     alignItems:'center',
    //     marginHorizontal: 5,
    // },
    //   textLogin:{
    //     color: '#000000',
    //     fontWeight: 'bold',
    //     fontSize:24,
    // },
 });
